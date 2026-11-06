const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function setup() {
  const app = { globalData: {} }
  const navigation = []
  const requests = []
  const events = []
  const timers = new Map()
  let nextTimer = 0
  const wx = {
    showToast() {},
    getStorageSync() { return '' },
    getWindowInfo() { return { windowHeight: 800 } },
    navigateTo: options => navigation.push(options),
    redirectTo: options => navigation.push(options),
    request: options => requests.push(options)
  }
  function load(file, component) {
    let definition
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
      getApp: () => app, wx,
      Page: value => { definition = value },
      Component: value => { definition = value },
      setTimeout: callback => { const id = ++nextTimer; timers.set(id, callback); return id },
      clearTimeout: id => timers.delete(id)
    })
    const instance = Object.assign({}, component ? definition.methods : definition, {
      data: JSON.parse(JSON.stringify(definition.data || {})),
      setData(patch) { Object.assign(this.data, patch) },
      triggerEvent(name, detail) { events.push({ name, detail }) }
    })
    return { definition, instance }
  }
  const home = load('pages/index/index.js').instance
  home.loadMenu = () => {}
  const wheel = load('components/wheel-panel/wheel-panel.js', true)
  Object.assign(wheel.instance.data, { active: false, familyId: null, authenticated: false })
  return { app, home, wheel, navigation, requests, events, timers, load, wx }
}

const tabEvent = tab => ({ currentTarget: { dataset: { tab } } })

test('card layout fits the remaining viewport while leaving the controls at their normal size', () => {
  const h = setup()
  const wheel = h.wheel.instance
  const css = fs.readFileSync(path.join(__dirname, '../components/wheel-panel/wheel-panel.wxss'), 'utf8')
  const canvas = css.match(/\.card-canvas\s*\{([^}]+)\}/)[1]
  const top = Number(canvas.match(/top:\s*([\d.]+)%/)[1]) / 100
  const margin = Number(canvas.match(/margin-top:\s*(-?[\d.]+)rpx/)[1])
  const origin = Number(canvas.match(/transform-origin:\s*50%\s+([\d.]+)rpx/)[1])
  wheel.wheelReady = true
  wheel.setData = (patch, callback) => { Object.assign(wheel.data, patch); if (callback) callback() }
  for (const stageHeight of [170, 260, 450]) {
    let selector
    wheel.createSelectorQuery = () => ({
      select(value) { selector = value; return this },
      boundingClientRect(callback) {
        callback(selector === '.page-scroll' ? { height: stageHeight + 160 } : { height: stageHeight, width: 347 })
        return this
      },
      exec() {}
    })
    wheel.fitDrawScreen()
    assert.equal(wheel.data.drawScreenHeight, stageHeight + 160)
    assert.ok(800 * 0.5 * wheel.data.cardScale <= stageHeight)
    assert.ok(wheel.data.cardScale > 0 && wheel.data.cardScale <= 1)
    // The visible card, not the 800rpx canvas, stays centered in the stage.
    const cardCenter = stageHeight * top + (margin + origin + (144 + 480 / 2 - origin) * wheel.data.cardScale) * 0.5
    assert.ok(Math.abs(cardCenter - stageHeight / 2) <= 1)
  }
})

test('a measurement queued before drawing cannot shrink the card after the draw completes', () => {
  const h = readyFamilyWheel()
  const wheel = h.wheel.instance
  wheel.setData = (patch, callback) => { Object.assign(wheel.data, patch); if (callback) callback() }
  wheel.setData({ hasFamily: false, cardScale: 0.7 })
  const measurements = []
  wheel.createSelectorQuery = () => ({
    select() { return this },
    boundingClientRect(callback) { measurements.push(callback); return this },
    exec() {}
  })
  wheel.fitDrawScreen()
  measurements[0]({ height: 500, width: 375 })
  assert.equal(measurements.length, 2)
  wheel.spinWheel()
  wheel.fitDrawScreen()
  assert.equal(measurements.length, 2)
  finishSpin(h)
  measurements[1]({ height: 50, width: 347 })
  assert.equal(wheel.data.cardScale, 0.7)
  assert.equal(wheel.data.cardFaceFront, true)
})

test('only the latest layout measurement applies and an unchanged viewport keeps its scale', () => {
  const h = readyFamilyWheel()
  const wheel = h.wheel.instance
  wheel.setData = (patch, callback) => { Object.assign(wheel.data, patch); if (callback) callback() }
  const measurements = []
  wheel.createSelectorQuery = () => ({
    select() { return this },
    boundingClientRect(callback) { measurements.push(callback); return this },
    exec() {}
  })
  wheel.fitDrawScreen()
  wheel.fitDrawScreen()
  measurements[1]({ height: 500, width: 375 })
  measurements[2]({ height: 280, width: 347 })
  assert.equal(wheel.data.cardScale, 0.7)
  measurements[0]({ height: 200, width: 375 })
  assert.equal(measurements.length, 3)
  wheel.fitDrawScreen()
  measurements[3]({ height: 500, width: 375 })
  assert.equal(measurements.length, 4)
  assert.equal(wheel.data.cardScale, 0.7)
  wheel.setData({ recording: true })
  wheel.fitDrawScreen()
  assert.equal(measurements.length, 4)
})

test('wheel uses the same tab switching as orders without navigation or clearing selected dishes', () => {
  const h = setup()
  h.home.onLoad()
  assert.equal(h.home.data.wheelVisited, false)
  h.home.setData({ basket: [{ dishId: 8, quantity: 2 }], basketVisible: true })
  for (const tab of ['wheel', 'orders', 'family', 'menu', 'wheel']) {
    h.home.switchTab(tabEvent(tab))
    assert.equal(h.home.data.activeTab, tab)
    assert.equal(h.home.data.basket[0].quantity, 2)
    assert.equal(h.home.data.basketVisible, false)
  }
  assert.equal(h.home.data.wheelVisited, true)
  assert.equal(h.navigation.length, 0)
})

test('wheel shares open the wheel tab and old share links redirect to that tab', () => {
  const h = setup()
  h.home.onLoad({ tab: 'wheel' })
  assert.equal(h.home.data.activeTab, 'wheel')
  assert.equal(h.home.data.wheelVisited, true)
  assert.equal(h.home.onShareAppMessage().path, '/pages/index/index?tab=wheel')
  assert.equal(h.home.onShareTimeline().query, 'tab=wheel')
  h.load('pages/wheel/wheel.js').instance.onLoad()
  assert.equal(h.navigation[0].url, '/pages/index/index?tab=wheel')
  h.home.switchTab(tabEvent('menu'))
  assert.equal(h.home.onShareAppMessage().path, '/pages/index/index')
})

test('wheel login and family actions switch the home tab', () => {
  const h = setup()
  h.home.showLogin = (...args) => { h.login = args }
  h.wheel.instance.goLogin()
  h.home.onWheelNavigate({ detail: h.events[0].detail })
  assert.equal(h.home.data.activeTab, 'family')
  assert.equal(h.login[2], 'family')
  h.wheel.instance.goBack()
  h.home.onWheelNavigate({ detail: h.events[1].detail })
  assert.equal(h.home.data.activeTab, 'menu')
  assert.equal(h.navigation.length, 0)
})

test('hidden wheel stays idle and switching tabs preserves a restaurant edit draft', () => {
  const h = setup()
  const { instance: wheel, definition } = h.wheel
  let loads = 0
  wheel.loadWheel = () => { loads++ }
  definition.lifetimes.attached.call(wheel)
  assert.equal(loads, 0)
  wheel.setData({ active: true })
  wheel.syncContext()
  assert.equal(loads, 1)
  wheel.setData({ editing: true, draft: [{ name: '餐厅草稿' }], active: false })
  wheel.syncContext()
  wheel.setData({ active: true })
  wheel.syncContext()
  assert.equal(wheel.data.draft[0].name, '餐厅草稿')
  assert.equal(wheel.data.editing, true)
  assert.equal(loads, 1)
})

test('changing family cancels a pending spin and clears the previous family draft', () => {
  const h = setup()
  const wheel = h.wheel.instance
  h.app.globalData = { sessionToken: 'test', currentUser: { userId: 1 }, familyId: 1 }
  wheel.syncContext()
  wheel.setData({ hasFamily: true, restaurants: [{ name: '旧家庭餐厅' }] })
  wheel.spinWheel()
  assert.equal(h.timers.size, 1)
  wheel.setData({ editing: true, draft: [{ name: '旧家庭草稿' }] })
  h.app.globalData.familyId = 2
  wheel.syncContext()
  assert.equal(h.timers.size, 0)
  assert.equal(wheel.data.spinning, false)
  assert.equal(wheel.data.editing, false)
  assert.equal(wheel.data.draft.length, 0)
  assert.equal(wheel.data.result, null)
})

test('a late guest restaurant response cannot replace a newly selected family wheel', async () => {
  const h = setup()
  const wheel = h.wheel.instance
  const pending = wheel.loadWheel()
  h.app.globalData = { sessionToken: 'test', currentUser: { userId: 1 }, familyId: 2 }
  wheel.syncContext()
  wheel.setData({ restaurants: [{ name: '当前家庭餐厅' }] })
  h.requests[0].success({ statusCode: 200, data: { data: [{ name: '游客餐厅' }] } })
  await pending
  assert.equal(wheel.data.restaurants[0].name, '当前家庭餐厅')
})

function readyFamilyWheel() {
  const h = setup()
  h.app.globalData = { sessionToken: 'test', currentUser: { userId: 1 }, familyId: 1 }
  h.wheel.definition.lifetimes.attached.call(h.wheel.instance)
  h.wheel.instance.setData({ hasFamily: true, loading: false })
  h.wheel.instance.applyRestaurants([
    { id: 1, name: '餐厅一' }, { id: 2, name: '餐厅二' }, { id: 3, name: '餐厅三' }
  ])
  return h
}

function nextFrame(h) {
  const [id, callback] = h.timers.entries().next().value
  h.timers.delete(id)
  callback()
}

function finishSpin(h) {
  let remaining = 20
  while (h.timers.size && remaining-- > 0) nextFrame(h)
  assert.equal(h.timers.size, 0)
}

const flushPromises = () => new Promise(resolve => setImmediate(resolve))

function readySpinHistory() {
  const h = readyFamilyWheel()
  const spins = Array.from({ length: 7 }, (_, i) => ({ id: 7 - i, restaurantName: '餐厅' + (7 - i) }))
  h.wheel.instance.setData(Object.assign({ loggedIn: true, historyVisible: true, allSpins: spins }, h.wheel.instance.spinLists(spins.slice(0, 5))))
  h.wx.showModal = options => { h.modal = options }
  return h
}

test('deleting history requires confirmation, replenishes recent records and removes the full-list row', async () => {
  const h = readySpinHistory()
  const wheel = h.wheel.instance
  const event = { currentTarget: { dataset: { id: 7 } } }
  wheel.deleteSpin(event)
  assert.equal(h.requests.length, 0)
  h.modal.success({ confirm: false })
  h.modal.complete()
  assert.equal(h.requests.length, 0)
  wheel.deleteSpin(event)
  h.modal.success({ confirm: true })
  h.modal.complete()
  assert.equal(h.requests[0].method, 'DELETE')
  assert.match(h.requests[0].url, /\/api\/families\/1\/wheel\/spins\/7$/)
  wheel.deleteSpin(event)
  wheel.spinWheel()
  wheel.startEdit()
  await wheel.loadWheel()
  assert.equal(h.requests.length, 1)
  assert.equal(h.timers.size, 0)
  assert.equal(wheel.data.editing, false)
  const recent = [6, 5, 4, 3, 2].map(id => ({ id, restaurantName: '餐厅' + id }))
  h.requests[0].success({ statusCode: 200, data: { data: { spins: recent } } })
  await flushPromises()
  assert.equal(wheel.data.recentSpins.length, 5)
  assert.equal(wheel.data.recentSpins[4].id, 2)
  assert.equal(wheel.data.allSpins.length, 6)
  assert.equal(wheel.data.allSpins.some(item => item.id === 7), false)
  assert.equal(wheel.data.deletingSpinId, null)
})

test('failed deletion keeps the record and enables retry', async () => {
  const h = readySpinHistory()
  const wheel = h.wheel.instance
  const event = { currentTarget: { dataset: { id: 7 } } }
  wheel.deleteSpin(event)
  h.modal.success({ confirm: true })
  h.modal.complete()
  h.requests[0].fail({ errMsg: '网络异常' })
  await flushPromises()
  assert.equal(wheel.data.allSpins.length, 7)
  assert.equal(wheel.data.recentSpins[0].id, 7)
  assert.equal(wheel.data.deletingSpinId, null)
  wheel.deleteSpin(event)
  h.modal.success({ confirm: true })
  h.modal.complete()
  assert.equal(h.requests.length, 2)
})

test('history deletion cannot run outside the full history or after a family switch during confirmation', () => {
  const h = readySpinHistory()
  const wheel = h.wheel.instance
  const event = { currentTarget: { dataset: { id: 7 } } }
  wheel.setData({ historyVisible: false })
  wheel.deleteSpin(event)
  assert.equal(h.modal, undefined)
  wheel.setData({ historyVisible: true })
  wheel.deleteSpin(event)
  h.app.globalData.familyId = 2
  wheel.syncContext()
  h.modal.success({ confirm: true })
  h.modal.complete()
  assert.equal(h.requests.length, 0)
})

test('a late deletion response cannot overwrite records after switching families away and back', async () => {
  const h = readySpinHistory()
  const wheel = h.wheel.instance
  wheel.deleteSpin({ currentTarget: { dataset: { id: 7 } } })
  h.modal.success({ confirm: true })
  h.modal.complete()
  h.app.globalData.familyId = 2
  wheel.syncContext()
  h.app.globalData.familyId = 1
  wheel.syncContext()
  wheel.setData({ allSpins: [{ id: 20 }], deletingSpinId: 20 })
  h.requests[0].success({ statusCode: 200, data: { data: { spins: [] } } })
  await flushPromises()
  assert.equal(wheel.data.allSpins[0].id, 20)
  assert.equal(wheel.data.deletingSpinId, 20)
})

test('an older full-history response cannot restore a deleted record', async () => {
  const h = readySpinHistory()
  const wheel = h.wheel.instance
  wheel.openHistory()
  wheel.closeHistory()
  wheel.openHistory()
  h.requests[1].success({ statusCode: 200, data: { data: [{ id: 7, restaurantName: '餐厅' }] } })
  await flushPromises()
  wheel.deleteSpin({ currentTarget: { dataset: { id: 7 } } })
  h.modal.success({ confirm: true })
  h.modal.complete()
  h.requests[2].success({ statusCode: 200, data: { data: { spins: [] } } })
  await flushPromises()
  h.requests[0].success({ statusCode: 200, data: { data: [{ id: 7, restaurantName: '旧记录' }] } })
  await flushPromises()
  assert.equal(wheel.data.allSpins.length, 0)
  assert.equal(wheel.data.recentSpins.length, 0)
})

test('refresh blocks drawing and editing until the current restaurant list is ready', async () => {
  const h = readyFamilyWheel()
  const wheel = h.wheel.instance
  const pending = wheel.loadWheel()
  wheel.spinWheel()
  wheel.startEdit()
  assert.equal(h.timers.size, 0)
  assert.equal(wheel.data.editing, false)
  h.requests[0].success({ statusCode: 200, data: { data: { restaurants: [{ id: 4, name: '新餐厅' }], spins: [] } } })
  await pending
  wheel.spinWheel()
  finishSpin(h)
  assert.equal(wheel.data.result.name, '新餐厅')
  assert.equal(h.requests[1].data.name, '新餐厅')
})

test('a failed refresh cannot draw from stale options and a successful retry restores drawing', async () => {
  const h = readyFamilyWheel()
  const wheel = h.wheel.instance
  const failed = wheel.loadWheel()
  h.requests[0].fail({ errMsg: '网络异常' })
  await failed
  wheel.spinWheel()
  wheel.startEdit()
  assert.equal(h.timers.size, 0)
  assert.equal(wheel.data.editing, false)
  const retried = wheel.loadWheel()
  h.requests[1].success({ statusCode: 200, data: { data: { restaurants: [{ id: 4, name: '恢复后的餐厅' }], spins: [] } } })
  await retried
  wheel.spinWheel()
  assert.equal(wheel.data.spinning, true)
})

test('a spinning wheel rejects editing, saving and background refreshes', async () => {
  const h = readyFamilyWheel()
  const wheel = h.wheel.instance
  wheel.spinWheel()
  wheel.startEdit()
  wheel.saveDraft()
  await wheel.loadWheel()
  assert.equal(wheel.data.editing, false)
  assert.equal(h.requests.length, 0)
  assert.equal(h.timers.size, 1)
  finishSpin(h)
  assert.ok(wheel.data.restaurants.some(row => row.name === wheel.data.result.name))
  assert.equal(h.requests[0].data.name, wheel.data.result.name)
})

test('editing blocks drawing and saving locks the draft until the response arrives', async () => {
  const h = readyFamilyWheel()
  const wheel = h.wheel.instance
  wheel.startEdit()
  wheel.spinWheel()
  assert.equal(h.timers.size, 0)
  wheel.inputDraft({ currentTarget: { dataset: { index: 0 } }, detail: { value: '新餐厅' } })
  wheel.saveDraft()
  const submitted = JSON.stringify(wheel.data.draft)
  wheel.cancelEdit()
  wheel.inputDraft({ currentTarget: { dataset: { index: 0 } }, detail: { value: '未提交的改动' } })
  wheel.addDraft()
  wheel.removeDraft({ currentTarget: { dataset: { index: 0 } } })
  wheel.spinWheel()
  wheel.saveDraft()
  await wheel.loadWheel()
  assert.equal(JSON.stringify(wheel.data.draft), submitted)
  assert.equal(wheel.data.editing, true)
  assert.equal(h.requests.length, 1)
  assert.equal(h.timers.size, 0)
  h.requests[0].success({ statusCode: 200, data: { data: { restaurants: [{ id: 4, name: '新餐厅' }], spins: [] } } })
  await flushPromises()
  assert.equal(wheel.data.saving, false)
  assert.equal(wheel.data.editing, false)
  wheel.spinWheel()
  finishSpin(h)
  assert.equal(wheel.data.result.name, '新餐厅')
})

test('recording blocks changes until either success or failure releases the wheel', async () => {
  for (const success of [true, false]) {
    const h = readyFamilyWheel()
    const wheel = h.wheel.instance
    wheel.spinWheel()
    finishSpin(h)
    assert.equal(wheel.data.recording, true)
    wheel.startEdit()
    wheel.spinWheel()
    await wheel.loadWheel()
    assert.equal(wheel.data.editing, false)
    assert.equal(h.requests.length, 1)
    assert.equal(h.timers.size, 0)
    if (success) {
      h.requests[0].success({ statusCode: 200, data: { data: { id: 10, restaurantName: wheel.data.result.name } } })
    } else {
      h.requests[0].fail({ errMsg: '网络异常' })
    }
    await flushPromises()
    assert.equal(wheel.data.recording, false)
    wheel.startEdit()
    assert.equal(wheel.data.editing, true)
  }
})

test('failed saving preserves the draft and allows retry', async () => {
  const h = readyFamilyWheel()
  const wheel = h.wheel.instance
  wheel.startEdit()
  wheel.saveDraft()
  h.requests[0].fail({ errMsg: '网络异常' })
  await flushPromises()
  assert.equal(wheel.data.saving, false)
  assert.equal(wheel.data.editing, true)
  assert.equal(wheel.data.draft.length, 3)
  wheel.saveDraft()
  assert.equal(h.requests.length, 2)
})

test('card drawing hides the result until flipping and records it exactly once after settling', () => {
  const h = readyFamilyWheel()
  const wheel = h.wheel.instance
  wheel.spinWheel()
  wheel.spinWheel()
  assert.equal(h.timers.size, 1)
  assert.equal(wheel.data.cardFaceFront, false)
  assert.equal(wheel.data.result, null)
  while (wheel.data.drawPhase !== 'flipping') {
    assert.equal(wheel.data.cardFaceFront, false)
    assert.equal(h.requests.length, 0)
    nextFrame(h)
  }
  assert.match(wheel.data.cardTransform, /scaleX\(0.02\)/)
  nextFrame(h)
  assert.equal(wheel.data.cardFaceFront, true)
  assert.equal(wheel.data.spinning, true)
  assert.ok(wheel.data.restaurants.includes(wheel.data.result))
  assert.equal(h.requests.length, 0)
  const token = wheel.spinToken
  finishSpin(h)
  assert.equal(wheel.data.spinning, false)
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].data.name, wheel.data.result.name)
  wheel.runDrawFrame(999, token)
  assert.equal(h.requests.length, 1)
  assert.ok(wheel.data.result)
})

test('unavailable worklet bindings use card transitions and ignore cancelled family callbacks', () => {
  const h = readyFamilyWheel()
  const wheel = h.wheel.instance
  h.wx.worklet = { shared: value => ({ value }), timing() {}, cancelAnimation() {}, Easing: {} }
  wheel.applyAnimatedStyle = () => { throw new Error('renderer cannot bind animated styles') }
  h.wheel.definition.lifetimes.ready.call(wheel)
  wheel.spinWheel()
  assert.equal(wheel.data.workletEnabled, false)
  const lateCompletion = h.timers.values().next().value
  h.app.globalData.familyId = 2
  wheel.syncContext()
  lateCompletion()
  assert.equal(wheel.data.cardFaceFront, false)
  assert.equal(wheel.data.drawPhase, 'idle')
  assert.equal(wheel.data.result, null)
  assert.equal(h.timers.size, 0)
  assert.equal(h.requests.length, 0)
})

test('worklet animates the card motion and records the same revealed restaurant', () => {
  const h = readyFamilyWheel()
  const wheel = h.wheel.instance
  const styles = {}
  h.wx.worklet = {
    shared: value => ({ value }),
    timing: target => target,
    cancelAnimation() {}, Easing: { cubicBezier() {} }
  }
  wheel.applyAnimatedStyle = (selector, style) => { styles[selector] = style }
  h.wheel.definition.lifetimes.ready.call(wheel)
  assert.equal(wheel.data.workletEnabled, true)
  wheel.spinWheel()
  nextFrame(h)
  assert.match(styles['#card-pack']().transform, /translate\(-14px, -4px\) rotate\(-5deg\)/)
  assert.match(styles['#draw-card']().transform, /translate\(-9px/)
  while (wheel.data.drawPhase !== 'holding') nextFrame(h)
  assert.equal(wheel.data.cardFaceFront, false)
  assert.match(styles['#card-deck']().transform, /translateY\(125px\) scale\(0.6\)/)
  assert.match(styles['#draw-card']().transform, /translate\(7px, -77px\)/)
  assert.equal(h.requests.length, 0)
  finishSpin(h)
  assert.equal(wheel.data.spinning, false)
  assert.equal(wheel.data.cardFaceFront, true)
  assert.equal(h.requests[0].data.name, wheel.data.result.name)
})

test('native completion commits one consistent final pose before recording or enabling redraw', () => {
  const h = readyFamilyWheel()
  const wheel = h.wheel.instance
  const completions = []
  const styles = {}
  h.wx.worklet = {
    shared: value => ({ value }),
    timing(target, options, callback) { if (callback) completions.push(callback); return target },
    cancelAnimation() {}, runOnJS: callback => callback, Easing: { cubicBezier() {} }
  }
  wheel.applyAnimatedStyle = (selector, style) => { styles[selector] = style }
  h.wheel.definition.lifetimes.ready.call(wheel)
  wheel.spinWheel()
  const staleTimer = h.timers.values().next().value
  completions.shift()(true)
  const currentFrame = wheel.drawFrameIndex
  staleTimer()
  assert.equal(wheel.drawFrameIndex, currentFrame)
  while (wheel.data.drawPhase !== 'settling') {
    completions.shift()(true)
  }
  assert.equal(wheel.data.spinning, true)
  assert.equal(wheel.data.hasSpun, false)
  assert.equal(h.requests.length, 0)
  const settle = completions.shift()
  settle(true)
  // The card stays landed for one hold beat before the wheel unlocks.
  assert.equal(wheel.data.spinning, true)
  assert.equal(wheel.data.drawPhase, 'landed')
  assert.equal(styles['#draw-card']().transform, 'translate(0px, 0px) rotate(0deg) scaleX(1)')
  assert.equal(styles['#card-deck']().transform, 'translateY(0px) scale(1)')
  assert.equal(styles['#card-pack']().transform, 'translate(0px, 0px) rotate(0deg)')
  assert.equal(h.requests.length, 0)
  const landed = completions.shift()
  landed(true)
  assert.equal(wheel.data.spinning, false)
  assert.equal(wheel.data.cardDuration, 0)
  assert.equal(styles['#draw-card']().transform, 'translate(0px, 0px) rotate(0deg) scaleX(1)')
  assert.equal(styles['#card-deck']().transform, 'translateY(0px) scale(1)')
  assert.equal(styles['#card-pack']().transform, 'translate(0px, 0px) rotate(0deg)')
  assert.equal(h.timers.size, 0)
  assert.equal(h.requests.length, 1)
  landed(true)
  assert.equal(h.requests.length, 1)
})

test('a missing native completion uses the watchdog and ignores callbacks arriving after cancellation', () => {
  const h = readyFamilyWheel()
  const wheel = h.wheel.instance
  const completions = []
  h.wx.worklet = {
    shared: value => ({ value }),
    timing(target, options, callback) { if (callback) completions.push(callback); return target },
    cancelAnimation() {}, runOnJS: callback => callback, Easing: { cubicBezier() {} }
  }
  wheel.applyAnimatedStyle = () => {}
  h.wheel.definition.lifetimes.ready.call(wheel)
  wheel.spinWheel()
  finishSpin(h)
  assert.equal(wheel.data.spinning, false)
  assert.equal(wheel.data.cardTransform, 'translate(0rpx, 0rpx) rotate(0deg) scaleX(1)')
  assert.equal(wheel.data.deckTransform, 'translateY(0rpx) scale(1)')
  assert.equal(h.requests.length, 1)
  completions.forEach(callback => callback(true))
  assert.equal(h.requests.length, 1)
  assert.equal(h.timers.size, 0)
})

test('all cards interpolate from one clock and saving the result never changes the final pose', async () => {
  const h = readyFamilyWheel()
  const wheel = h.wheel.instance
  const targets = []
  const styles = {}
  h.wx.worklet = {
    shared: value => ({ value }),
    timing(target) { targets.push(target); return target },
    cancelAnimation() {}, Easing: { cubicBezier() {} }
  }
  wheel.applyAnimatedStyle = (selector, style) => { styles[selector] = style }
  h.wheel.definition.lifetimes.ready.call(wheel)
  wheel.spinWheel()
  while (wheel.data.drawPhase !== 'settling') nextFrame(h)
  // One timing command per phase replaces independent commands for nine axes.
  assert.deepEqual(targets, Array.from({ length: targets.length }, (_, i) => i + 1))
  wheel.cardMotion.progress.value = targets.length - 0.5
  assert.equal(styles['#draw-card']().transform, 'translate(0px, -30px) rotate(0deg) scaleX(1)')
  assert.equal(styles['#card-deck']().transform, 'translateY(62.5px) scale(0.8)')
  wheel.cardMotion.progress.value = targets.length
  const landedPose = Object.fromEntries(Object.entries(styles).map(([key, value]) => [key, value()]))
  nextFrame(h)
  // The landed hold still reads the same resting pose and does not record yet.
  assert.equal(wheel.data.drawPhase, 'landed')
  assert.equal(wheel.data.spinning, true)
  assert.equal(wheel.data.recording, false)
  assert.deepEqual(Object.fromEntries(Object.entries(styles).map(([key, value]) => [key, value()])), landedPose)
  nextFrame(h)
  assert.equal(wheel.data.recording, true)
  assert.equal(wheel.cardMotion.progress.value, targets.length)
  assert.deepEqual(Object.fromEntries(Object.entries(styles).map(([key, value]) => [key, value()])), landedPose)
  h.requests[0].success({ statusCode: 200, data: { data: { id: 88, restaurantName: wheel.data.result.name } } })
  await flushPromises()
  assert.equal(wheel.data.recording, false)
  assert.deepEqual(Object.fromEntries(Object.entries(styles).map(([key, value]) => [key, value()])), landedPose)
})

test('the front is prepared before flipping and becomes visible on the UI clock before JS advances', async () => {
  const h = readyFamilyWheel()
  const wheel = h.wheel.instance
  const styles = {}
  h.wx.worklet = {
    shared: value => ({ value }), timing: target => target,
    cancelAnimation() {}, Easing: { cubicBezier() {} }
  }
  wheel.applyAnimatedStyle = (selector, style) => { styles[selector] = style }
  h.wheel.definition.lifetimes.ready.call(wheel)
  wheel.spinWheel()
  assert.ok(wheel.data.cardRestaurantName)
  assert.equal(wheel.data.result, null)
  while (wheel.data.drawPhase !== 'flipping') nextFrame(h)
  const edge = wheel.cardMotion.progress.value
  wheel.cardMotion.progress.value = edge - 0.01
  assert.equal(styles['#card-back-face']().opacity, 1)
  assert.equal(styles['#card-front-face']().opacity, 0)
  wheel.cardMotion.progress.value = edge
  // The JS phase callback is intentionally delayed. The UI already has the face ready.
  assert.equal(wheel.data.cardFaceFront, false)
  assert.equal(wheel.data.result, null)
  assert.equal(styles['#card-back-face']().opacity, 0)
  assert.equal(styles['#card-front-face']().opacity, 1)
  finishSpin(h)
  assert.equal(wheel.data.cardRestaurantName, wheel.data.result.name)
  h.requests[0].success({ statusCode: 200, data: { data: { id: 89, restaurantName: wheel.data.result.name } } })
  await flushPromises()
  wheel.startEdit()
  wheel.saveDraft()
  h.requests[1].success({ statusCode: 200, data: { data: { restaurants: [{ name: '更新后的餐厅' }], spins: [] } } })
  await flushPromises()
  assert.equal(wheel.data.cardRestaurantName, '')
  assert.equal(styles['#card-front-face']().opacity, 0)
  assert.equal(styles['#card-back-face']().opacity, 1)
})

test('repeat draws turn the old result face down and detaching cancels pending reveal and recording', () => {
  const h = readyFamilyWheel()
  const wheel = h.wheel.instance
  wheel.setData({ hasFamily: false })
  wheel.spinWheel()
  finishSpin(h)
  wheel.spinWheel()
  assert.equal(wheel.data.cardFaceFront, false)
  const lateCompletion = h.timers.values().next().value
  h.wheel.definition.lifetimes.detached.call(wheel)
  lateCompletion()
  assert.equal(h.timers.size, 0)
  assert.equal(h.requests.length, 0)
})

test('fallback shakes the whole pack, separates the top card before flipping and restores the deck', () => {
  const h = readyFamilyWheel()
  const wheel = h.wheel.instance
  wheel.setData({ hasFamily: false })
  wheel.spinWheel()
  nextFrame(h)
  assert.notEqual(wheel.data.packTransform, 'translate(0rpx, 0rpx) rotate(0deg)')
  while (wheel.data.drawPhase !== 'holding') nextFrame(h)
  assert.match(wheel.data.cardTransform, /-154rpx/)
  assert.equal(wheel.data.deckTransform, 'translateY(250rpx) scale(0.6)')
  assert.equal(wheel.data.cardFaceFront, false)
  assert.equal(wheel.data.result, null)
  nextFrame(h)
  assert.equal(wheel.data.drawPhase, 'flipping')
  finishSpin(h)
  assert.equal(wheel.data.deckTransform, 'translateY(0rpx) scale(1)')
  assert.equal(wheel.data.packTransform, 'translate(0rpx, 0rpx) rotate(0deg)')
  wheel.spinWheel()
  h.app.globalData.familyId = 2
  wheel.syncContext()
  assert.equal(wheel.data.deckTransform, 'translateY(0rpx) scale(1)')
  assert.equal(wheel.data.packTransform, 'translate(0rpx, 0rpx) rotate(0deg)')
})
