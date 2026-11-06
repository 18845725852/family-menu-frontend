const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function setup() {
  const families = [{ id: 1, name: '家庭一', ownerUserId: 10 }, { id: 2, name: '家庭二', ownerUserId: 20 }]
  const app = { globalData: { familyId: 1, sessionToken: 'test', currentUser: { userId: 10 } } }
  const requests = []
  const publicRequests = []
  const snapshots = []
  let definition
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/index/index.js'), 'utf8'), {
    getApp: () => app, Page: value => { definition = value },
    wx: { setStorageSync() {}, request: value => publicRequests.push(value) }
  })
  const page = Object.assign({}, definition, {
    data: Object.assign(JSON.parse(JSON.stringify(definition.data)), { families, familyId: 1, family: families[0], loggedIn: true }),
    setData(patch, callback) {
      Object.assign(this.data, patch)
      snapshots.push({ family: this.data.family, loading: this.data.familyLoading })
      if (callback) callback.call(this)
    },
    refreshDisplayDishes() {},
    loadOrders: () => Promise.resolve(),
    loadMenu: () => Promise.resolve(),
    authRequest(url) {
      return new Promise((resolve, reject) => requests.push({ url, resolve, reject }))
    }
  })
  return { page, app, requests, publicRequests, snapshots, definition }
}

const select = id => ({ currentTarget: { dataset: { id } } })

function resolveFamily(h, offset, id) {
  h.requests[offset].resolve({ id, name: '家庭' + id, ownerUserId: id === 1 ? 10 : 20 })
  h.requests[offset + 1].resolve([{ id: id * 100, userId: 20, nickname: '成员', role: 'OWNER' }])
}

test('switching retains the family card and stays loading until both details and members arrive', async () => {
  const h = setup()
  const pending = h.page.switchFamily(select(2))
  assert.equal(h.page.data.family.id, 2)
  assert.equal(h.page.data.familyLoading, true)
  h.requests[0].resolve({ id: 2, name: '家庭二', ownerUserId: 20 })
  await Promise.resolve()
  assert.equal(h.page.data.familyLoading, true)
  h.requests[1].resolve([{ id: 200, userId: 20, nickname: '成员', role: 'OWNER' }])
  await pending
  assert.equal(h.page.data.familyLoading, false)
  assert.equal(h.page.data.members.length, 1)
  assert.ok(h.snapshots.every(state => state.family || state.loading))
})

test('rapid switching back to the same family ignores earlier failures and successes', async () => {
  const h = setup()
  const first = h.page.switchFamily(select(2))
  const second = h.page.switchFamily(select(1))
  const latest = h.page.switchFamily(select(2))
  h.requests[0].reject(new Error('旧请求失败'))
  h.requests[1].resolve([])
  await first
  assert.equal(h.page.data.familyLoading, true)
  assert.equal(h.page.data.familyLoadError, '')
  resolveFamily(h, 4, 2)
  await latest
  resolveFamily(h, 2, 1)
  await second
  assert.equal(h.page.data.family.id, 2)
  assert.equal(h.app.globalData.family.id, 2)
  assert.equal(h.page.data.familyLoading, false)
})

test('a failed switch keeps the selected family and presents a retryable error', async () => {
  const h = setup()
  const pending = h.page.switchFamily(select(2))
  h.requests[0].reject(new Error('网络异常'))
  h.requests[1].resolve([])
  await pending
  assert.equal(h.page.data.familyId, 2)
  assert.equal(h.app.globalData.familyId, 2)
  assert.equal(h.page.data.family.id, 2)
  assert.equal(h.page.data.familyLoading, false)
  assert.equal(h.page.data.familyLoadError, '网络异常')
})

test('an older menu response cannot end loading or replace the newly selected family menu', async () => {
  const h = setup()
  h.page.loadMenu = h.definition.loadMenu
  const old = h.page.loadMenu()
  h.app.globalData.familyId = 2
  const latest = h.page.loadMenu()
  h.publicRequests[0].success({ statusCode: 200, data: { data: [] } })
  h.requests[0].resolve({ customMenu: true, dishes: [{ id: 1, name: '旧菜品' }] })
  await old
  assert.equal(h.page.data.loading, true)
  assert.equal(h.page.data.dishes.length, 0)
  h.publicRequests[1].success({ statusCode: 200, data: { data: [] } })
  h.requests[1].resolve({ customMenu: true, dishes: [{ id: 2, name: '新菜品' }] })
  await latest
  assert.equal(h.page.data.loading, false)
  assert.equal(h.page.data.dishes[0].name, '新菜品')
})
