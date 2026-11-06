const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function setup(userId = 10) {
  const app = { globalData: { currentUser: { userId: userId }, sessionToken: 'test', familyId: 1, pendingBasket: [1], orderEditing: true } }
  const storage = new Map([['familyId', 1]])
  const calls = []
  const toasts = []
  const families = [{ id: 1, name: '原家庭', ownerUserId: 10 }, { id: 2, name: '其他家庭', ownerUserId: 50 }]
  const members = [
    { id: 101, userId: 10, nickname: '创建者', role: 'OWNER' },
    { id: 102, userId: 20, nickname: '成员', role: 'MEMBER' },
    { id: 103, userId: 30, nickname: '管理员', role: 'ADMIN' }
  ]
  let definition
  let modal
  let actionSheet
  let fail = false
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/index/index.js'), 'utf8'), {
    getApp: () => app,
    Page: value => { definition = value },
    console,
    wx: {
      showToast: value => toasts.push(value),
      showModal: value => { modal = value },
      showActionSheet: value => { actionSheet = value },
      setStorageSync: (key, value) => storage.set(key, value),
      removeStorageSync: key => storage.delete(key)
    }
  })
  const page = Object.assign({}, definition, {
    data: Object.assign(JSON.parse(JSON.stringify(definition.data)), { familyId: 1, loggedIn: true }),
    setData(value) { Object.assign(this.data, value) },
    loadMenu() { this.setData({ customMenu: !!this.data.familyId }); return Promise.resolve() },
    authRequest(url, options = {}) {
      calls.push({ url, method: options.method || 'GET', data: options.data })
      if (fail) return Promise.reject(new Error('模拟请求失败'))
      if (url === '/api/families') {
        if (options.method === 'POST') {
          const family = { id: 3, name: options.data.name, ownerUserId: userId }
          families.push(family)
          return Promise.resolve(family)
        }
        return Promise.resolve(families.slice())
      }
      const match = url.match(/^\/api\/families\/(\d+)(.*)$/)
      assert.ok(match, url)
      const id = Number(match[1])
      const tail = match[2]
      if (tail === '/members') return Promise.resolve(members.slice())
      if (tail.startsWith('/members/') && options.method === 'DELETE') {
        if (Number(tail.split('/').pop()) === 102 && userId === 20) families.splice(families.findIndex(item => item.id === id), 1)
        return Promise.resolve()
      }
      if (tail === '/orders') return Promise.resolve([])
      const index = families.findIndex(item => item.id === id)
      if (options.method === 'PUT') {
        families[index] = Object.assign({}, families[index], { name: options.data.name })
      }
      if (options.method === 'DELETE') {
        families.splice(index, 1)
        return Promise.resolve()
      }
      return Promise.resolve(families[index])
    }
  })
  return { page, app, calls, toasts, families, storage, modal: () => modal, actionSheet: () => actionSheet, fail: () => { fail = true } }
}

test('owner has management and removal actions; members and admins only have their own exit', async () => {
  for (const userId of [10, 20, 30, 40]) {
    const h = setup(userId)
    await h.page.loadFamilies()
    assert.equal(h.page.data.familyOwner, userId === 10)
    const actionable = h.page.data.members.filter(item => item.canRemove).map(item => item.userId)
    assert.equal(JSON.stringify(actionable), JSON.stringify(userId === 10 ? [20, 30] : userId === 40 ? [] : [userId]))
    h.page.manageFamily()
    assert.equal(!!h.actionSheet(), userId === 10)
  }
})

test('creating a first owned family while already in another family switches context and preserves membership', async () => {
  for (const userId of [20, 30]) {
    const h = setup(userId)
    await h.page.loadFamilies()
    h.page.setData({ basket: [1], basketCount: 1, orders: [1], editMode: true, selectedIds: [1] })
    h.page.openFamily()
    assert.equal(h.page.data.familyVisible, true)
    assert.equal(h.page.data.familyEditingId, null)
    h.page.setData({ familyName: '  我的新家庭  ' })
    await h.page.saveFamily()
    assert.equal(h.page.data.families.length, 3)
    assert.equal(h.page.data.familyId, 3)
    assert.equal(h.page.data.family.name, '我的新家庭')
    assert.equal(h.page.data.familyOwner, true)
    assert.equal(h.page.data.hasOwnedFamily, true)
    assert.equal(h.app.globalData.familyId, 3)
    assert.equal(h.storage.get('familyId'), 3)
    assert.equal(h.page.data.basket.length, 0)
    assert.equal(h.page.data.orders.length, 0)
    assert.equal(h.page.data.editMode, false)
    assert.equal(h.app.globalData.pendingBasket.length, 0)
    assert.equal(h.page.data.familyVisible, false)
    assert.equal(h.page.data.familySaving, false)
    assert.ok(h.calls.some(item => item.url === '/api/families/3/orders'))
  }
})

test('owning any family prevents creation even when viewing another family', async () => {
  const h = setup()
  await h.page.loadFamilies()
  assert.equal(h.page.data.hasOwnedFamily, true)
  h.page.switchFamily({ currentTarget: { dataset: { id: 2 } } })
  await h.page.loadFamily(2)
  assert.equal(h.page.data.familyOwner, false)
  assert.equal(h.page.data.hasOwnedFamily, true)
  h.page.openFamily()
  assert.equal(h.page.data.familyVisible, false)
  h.page.setData({ familyName: '重复创建' })
  await h.page.createFamily()
  assert.equal(h.calls.filter(item => item.method === 'POST').length, 0)
})

test('rename prefills the editor and immediately updates the chip, detail and global family', async () => {
  const h = setup()
  await h.page.loadFamilies()
  h.page.manageFamily()
  h.actionSheet().success({ tapIndex: 0 })
  assert.equal(h.page.data.familyName, '原家庭')
  h.page.setData({ familyName: '  新家庭  ' })
  await h.page.saveFamily()
  assert.equal(h.page.data.family.name, '新家庭')
  assert.equal(h.page.data.families[0].name, '新家庭')
  assert.equal(h.app.globalData.family.name, '新家庭')
  assert.equal(h.page.data.familyVisible, false)
  assert.equal(h.page.data.familySaving, false)
  assert.equal(h.calls.filter(item => item.method === 'PUT').length, 1)
})

test('invalid names, failed saves and duplicate clicks preserve edit state correctly', async () => {
  const h = setup()
  await h.page.loadFamilies()
  h.page.editFamily()
  for (const name of ['  ', '家'.repeat(31)]) {
    h.page.setData({ familyName: name })
    await h.page.saveFamily()
  }
  assert.equal(h.calls.filter(item => item.method === 'PUT').length, 0)
  h.page.setData({ familyName: '新名称', familySaving: true })
  await h.page.saveFamily()
  h.page.closeFamily()
  assert.equal(h.page.data.familyVisible, true)
  h.page.setData({ familySaving: false })
  h.fail()
  await h.page.saveFamily()
  assert.equal(h.page.data.family.name, '原家庭')
  assert.equal(h.page.data.familyVisible, true)
  assert.equal(h.page.data.familySaving, false)
})

test('deletion refreshes family tabs, switches family and clears orders, basket and edit mode', async () => {
  const h = setup()
  await h.page.loadFamilies()
  h.page.setData({ basket: [1], basketCount: 1, editMode: true, selectedIds: [1], orders: [1], dishEditorVisible: true })
  h.page.inviteCodes = { 1: 'ABCDEF' }
  h.page.deleteFamily()
  assert.match(h.modal().content, /订单和抽卡数据/)
  await h.modal().success({ confirm: true })
  assert.equal(h.page.data.families.length, 1)
  assert.equal(h.page.data.familyId, 2)
  assert.equal(h.storage.get('familyId'), 2)
  assert.equal(h.app.globalData.familyId, 2)
  assert.equal(h.page.data.familyOwner, false)
  assert.equal(h.page.data.editMode, false)
  assert.equal(h.page.data.hasOwnedFamily, false)
  h.page.openFamily()
  assert.equal(h.page.data.familyVisible, true)
  assert.equal(h.page.data.basket.length, 0)
  assert.equal(h.page.data.orders.length, 0)
  assert.equal(h.page.data.dishEditorVisible, false)
  assert.equal(h.app.globalData.pendingBasket.length, 0)
  assert.equal(h.page.inviteCodes[1], undefined)
  assert.equal(h.page.data.familyDeleting, false)
  assert.ok(h.calls.some(item => item.url === '/api/families/2/orders'))
})

test('deleting the last family clears storage and returns to the default menu', async () => {
  const h = setup()
  h.families.pop()
  await h.page.loadFamilies()
  h.page.deleteFamily()
  await h.modal().success({ confirm: true })
  assert.equal(h.page.data.familyId, null)
  assert.equal(h.page.data.family, null)
  assert.equal(h.app.globalData.family, null)
  assert.equal(h.storage.has('familyId'), false)
  assert.equal(h.page.data.customMenu, false)
  assert.equal(h.page.data.familyOwner, false)
})

test('cancelled or failed deletion preserves the family', async () => {
  const h = setup()
  await h.page.loadFamilies()
  h.page.deleteFamily()
  await h.modal().success({ confirm: false })
  assert.equal(h.calls.filter(item => item.method === 'DELETE').length, 0)
  h.fail()
  h.page.deleteFamily()
  await h.modal().success({ confirm: true })
  assert.equal(h.page.data.familyId, 1)
  assert.equal(h.page.data.families.length, 2)
  assert.equal(h.page.data.familyDeleting, false)
})

test('member cannot manage family or remove others but can leave and immediately lose the tab', async () => {
  const h = setup(20)
  await h.page.loadFamilies()
  h.page.editFamily()
  h.page.deleteFamily()
  h.page.removeMember({ currentTarget: { dataset: { id: 103 } } })
  assert.equal(h.modal(), undefined)
  assert.equal(h.page.data.familyVisible, false)
  h.page.removeMember({ currentTarget: { dataset: { id: 102 } } })
  assert.equal(h.modal().title, '退出家庭组')
  await h.modal().success({ confirm: true })
  assert.equal(h.page.data.familyId, 2)
  assert.equal(h.page.data.families.length, 1)
})

test('a delayed confirmation after switching family cannot delete the wrong family', async () => {
  const h = setup()
  await h.page.loadFamilies()
  h.page.deleteFamily()
  const modal = h.modal()
  h.page.setData({ familyId: 2, family: h.families[1] })
  await modal.success({ confirm: true })
  assert.equal(h.calls.filter(item => item.method === 'DELETE').length, 0)
})
