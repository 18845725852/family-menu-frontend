const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function setup() {
  const app = { globalData: { familyId: 1, currentUser: { userId: 10 }, sessionToken: 'test', pendingBasket: [1], orderEditing: true } }
  const calls = []
  const toasts = []
  let resolve, reject, definition
  const pending = new Promise((yes, no) => { resolve = yes; reject = no })
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/index/index.js'), 'utf8'), {
    getApp: () => app,
    Page: value => { definition = value },
    wx: { showLoading() {}, hideLoading() {}, showToast: value => toasts.push(value) }
  })
  const page = Object.assign({}, definition, {
    data: Object.assign(JSON.parse(JSON.stringify(definition.data)), {
      familyId: 1, categories: [{ id: 1, name: '家常菜' }], basket: [{ dishId: 1 }], selectedIds: [1]
    }),
    setData(data, callback) { Object.assign(this.data, data); if (callback) callback.call(this) },
    authRequest(url, options) { calls.push({ url, options }); return pending },
    measureDishSections() {}
  })
  return { app, page, calls, toasts, resolve, reject }
}

test('menu switch sends one request while pending and applies the returned family dishes', async () => {
  const h = setup()
  const pending = h.page.toggleCustomMenu({ detail: { value: true } })
  assert.equal(h.page.data.customMenuSaving, true)
  h.page.toggleCustomMenu({ detail: { value: true } })
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].url, '/api/families/1/menu')
  h.resolve({ customMenu: true, dishes: [{ id: 99, name: '新菜', category: '家常菜', recipe: '1.洗菜\n2.下锅' }] })
  await pending
  assert.equal(h.page.data.customMenuSaving, false)
  assert.equal(h.page.data.customMenu, true)
  assert.equal(h.page.data.dishSections[0].dishes[0].id, 99)
  assert.equal(h.page.data.dishes[0].recipeSteps.length, 2)
  assert.equal(h.page.data.basket.length, 0)
  assert.equal(h.page.data.selectedIds.length, 0)
  assert.equal(h.app.globalData.pendingBasket.length, 0)
})

test('failed switch restores the prior mode and preserves the basket', async () => {
  const h = setup()
  const pending = h.page.toggleCustomMenu({ detail: { value: true } })
  h.reject(new Error('切换失败'))
  await pending
  assert.equal(h.page.data.customMenu, false)
  assert.equal(h.page.data.customMenuSaving, false)
  assert.equal(h.page.data.basket.length, 1)
  assert.equal(h.toasts[0].title, '切换失败')
})

test('late success and failure responses cannot overwrite another family menu', async () => {
  for (const fail of [false, true]) {
    const h = setup()
    const pending = h.page.toggleCustomMenu({ detail: { value: true } })
    h.app.globalData.familyId = 2
    h.page.setData({ familyId: 2, customMenu: true, dishes: [{ id: 200 }] })
    if (fail) h.reject(new Error('旧家庭请求失败'))
    else h.resolve({ customMenu: false, dishes: [{ id: 100 }] })
    await pending
    assert.equal(h.page.data.customMenu, true)
    assert.equal(h.page.data.dishes[0].id, 200)
    assert.equal(h.toasts.length, 0)
    assert.equal(h.page.data.customMenuSaving, false)
  }
})

test('disabling the family menu exits edit mode and displays defaults', async () => {
  const h = setup()
  h.page.setData({ customMenu: true, editMode: true })
  const pending = h.page.toggleCustomMenu({ detail: { value: false } })
  h.resolve({ customMenu: false, dishes: [{ id: 1, name: '默认菜', category: '家常菜' }] })
  await pending
  assert.equal(h.page.data.customMenu, false)
  assert.equal(h.page.data.editMode, false)
  assert.equal(h.page.data.dishes[0].id, 1)
})
