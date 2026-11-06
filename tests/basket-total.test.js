const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function setup() {
  let definition
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/index/index.js'), 'utf8'), {
    getApp: () => ({ globalData: {} }),
    Page: value => { definition = value },
    wx: { showToast() {} }
  })
  return Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback.call(this) },
    refreshDisplayDishes() {}
  })
}

test('quantity changes count dish types and portions separately, including removal', () => {
  const page = setup()
  page.data.dishes = [{ id: 1, name: '番茄炒蛋' }, { id: 2, name: '青菜' }]
  page.changeDish(1, 1)
  page.changeDish(1, 1)
  page.changeDish(2, 1)
  assert.equal(page.data.basketCount, 2)
  assert.equal(page.data.basketTotal, 3)
  page.changeDish(2, -1)
  assert.equal(page.data.basketCount, 1)
  assert.equal(page.data.basketTotal, 2)
  page.clearBasket()
  assert.equal(page.data.basketCount, 0)
  assert.equal(page.data.basketTotal, 0)
})

test('opening the basket retains the total from selected dish quantities', () => {
  const page = setup()
  page.data.dishes = [{ id: 1, name: '番茄炒蛋', quantity: 3 }, { id: 2, name: '青菜', quantity: 2 }]
  page.openBasket()
  assert.equal(page.data.basketCount, 2)
  assert.equal(page.data.basketTotal, 5)
  assert.equal(page.data.basketVisible, true)
})

test('reopening a restored basket retains its portion total', () => {
  const page = setup()
  page.data.basket = [{ dishId: 1, quantity: 4 }]
  page.openBasket()
  assert.equal(page.data.basketCount, 1)
  assert.equal(page.data.basketTotal, 4)
})
