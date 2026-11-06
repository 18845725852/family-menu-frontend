const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function setup(native = false, failBinding = false) {
  let pageDef, componentDef, row
  const events = [], pageUpdates = [], rowUpdates = []
  const wx = { getWindowInfo: () => ({ windowWidth: 375 }) }
  if (native) wx.worklet = {
    shared: value => ({ value }), timing: target => target, cancelAnimation() {},
    runOnJS: callback => (...args) => callback.apply(row, args)
  }
  const context = { getApp: () => ({ globalData: {} }), wx,
    Page: value => { pageDef = value }, Component: value => { componentDef = value } }
  for (const file of ['pages/index/index.js', 'components/order-swipe/order-swipe.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context)
  }
  const page = Object.assign({}, pageDef, {
    data: JSON.parse(JSON.stringify(pageDef.data)),
    setData(patch) { pageUpdates.push(patch); Object.assign(this.data, patch) }
  })
  const styles = {}
  row = Object.assign({}, componentDef.methods, {
    data: Object.assign(JSON.parse(JSON.stringify(componentDef.data)), { opened: false, disabled: false, deleting: false }),
    setData(patch) { rowUpdates.push(patch); Object.assign(this.data, patch) },
    triggerEvent(name, detail) {
      events.push({ name, detail })
      const event = { currentTarget: { dataset: { id: 1 } }, detail }
      if (name === 'dragstart') page.onOrderSwipeStart(event)
      if (name === 'dragend') page.onOrderSwipeEnd(event)
    }
  })
  if (native) row.applyAnimatedStyle = (selector, style) => {
    if (failBinding) throw new Error('binding unavailable')
    styles[selector] = style
  }
  componentDef.lifetimes.attached.call(row)
  componentDef.lifetimes.ready.call(row)
  pageUpdates.length = rowUpdates.length = 0
  return { page, row, componentDef, events, pageUpdates, rowUpdates, styles }
}
const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }] })

test('native dragging updates only the UI offset, with two page events per gesture', () => {
  const h = setup(true)
  h.row.onGesture({ state: 1 })
  for (let i = 0; i < 100; i++) h.row.onGesture({ state: 2, deltaX: -0.5 })
  assert.equal(h.styles['#swipe-content']().transform, 'translateX(-50px)')
  assert.equal(h.rowUpdates.length, 0)
  assert.equal(h.pageUpdates.length, 1)
  assert.equal(h.page.data.orderSwipeDragging, true)
  h.page.onOrderScroll()
  assert.equal(h.page.data.orderSwipeDragging, true)
  h.row.onGesture({ state: 3 })
  assert.equal(h.pageUpdates.length, 2)
  assert.equal(h.page.data.orderSwipeId, 1)
  assert.equal(h.page.data.orderSwipeDragging, false)
  assert.equal(h.styles['#swipe-content']().transform, 'translateX(-72px)')
})

test('native right swipe closes an open row and cancellation releases scrolling', () => {
  const h = setup(true)
  h.row.swipeOffset.value = -72
  h.row.onGesture({ state: 1 })
  h.row.onGesture({ state: 2, deltaX: 65 })
  h.row.onGesture({ state: 3 })
  assert.equal(h.row.swipeOffset.value, 0)
  assert.equal(h.page.data.orderSwipeId, null)
  h.row.onGesture({ state: 1 })
  h.row.onGesture({ state: 2, deltaX: -500 })
  assert.equal(h.row.swipeOffset.value, -72)
  h.row.onGesture({ state: 4 })
  assert.equal(h.row.swipeOffset.value, 0)
  assert.equal(h.page.data.orderSwipeDragging, false)
})

test('touch events do not duplicate native gesture updates', () => {
  const h = setup(true)
  h.row.onTouchStart(touch(200, 100))
  h.row.onTouchMove(touch(100, 101))
  h.row.onTouchEnd()
  assert.equal(h.events.length, 0)
  assert.equal(h.rowUpdates.length, 0)
})

test('fallback drags refresh only their row and keep vertical movement available', () => {
  const h = setup()
  h.row.onTouchStart(touch(200, 100))
  h.row.onTouchMove(touch(197, 130))
  h.row.onTouchMove(touch(100, 131))
  h.row.onTouchEnd()
  assert.equal(h.events.length, 0)
  h.row.onTouchStart(touch(200, 100))
  h.row.onTouchMove(touch(170, 103))
  h.row.onTouchMove(touch(140, 130))
  assert.equal(h.row.data.offset, -120)
  assert.equal(h.pageUpdates.length, 1)
  h.row.onTouchEnd()
  assert.equal(h.row.data.offset, -144)
  assert.equal(h.page.data.orderSwipeId, 1)
  assert.equal(h.page.data.orderSwipeDragging, false)
})

test('fallback ignores redundant movements at the boundary and cancels multi-touch', () => {
  const h = setup()
  h.row.onTouchStart(touch(200, 100))
  h.row.onTouchMove(touch(100, 101))
  const updates = h.rowUpdates.length
  h.row.onTouchMove(touch(90, 101))
  assert.equal(h.rowUpdates.length, updates)
  h.row.onTouchMove({ touches: [{}, {}] })
  assert.equal(h.row.data.offset, 0)
  assert.equal(h.page.data.orderSwipeDragging, false)
})

test('failed animated bindings retain working row-local touch gestures', () => {
  const h = setup(true, true)
  assert.equal(h.row.data.nativeEnabled, false)
  h.row.onTouchStart(touch(200, 100))
  h.row.onTouchMove(touch(140, 101))
  h.row.onTouchEnd()
  assert.equal(h.row.data.offset, -144)
  assert.equal(h.page.data.orderSwipeId, 1)
})

test('disabling a row mid-drag releases the page lock and blocks deletion', () => {
  for (const native of [false, true]) {
    const h = setup(native)
    if (native) h.row.onGesture({ state: 1 })
    else { h.row.onTouchStart(touch(200, 100)); h.row.onTouchMove(touch(150, 100)) }
    h.row.data.disabled = true
    h.componentDef.observers.disabled.call(h.row, true)
    assert.equal(h.page.data.orderSwipeDragging, false)
    const count = h.events.length
    h.row.deleteOrder()
    assert.equal(h.events.length, count)
  }
})

test('opening a different row closes the previous row and normal scrolling closes the new one', () => {
  const h = setup()
  h.page.data.orderSwipeId = 2
  h.row.onTouchStart(touch(200, 100))
  h.row.onTouchMove(touch(130, 101))
  assert.equal(h.page.data.orderSwipeId, null)
  h.row.onTouchEnd()
  assert.equal(h.page.data.orderSwipeId, 1)
  h.page.onOrderScroll()
  assert.equal(h.page.data.orderSwipeId, null)
  h.componentDef.observers.opened.call(h.row, false)
  assert.equal(h.row.data.offset, 0)
})

test('resizing updates native travel width and also works after a binding failure', () => {
  for (const failed of [false, true]) {
    const h = setup(true, failed)
    h.row.data.opened = true
    h.componentDef.pageLifetimes.resize.call(h.row, { size: { windowWidth: 750 } })
    if (!failed) {
      assert.equal(h.row.swipeWidth.value, 144)
      assert.equal(h.row.swipeOffset.value, -144)
    }
  }
})
