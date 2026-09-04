const app = getApp()

function request(path, options) {
  options = options || {}
  return new Promise((resolve, reject) => {
    wx.request({
      url: (app.globalData.apiBaseUrl || '') + path,
      method: options.method || 'GET',
      data: options.data,
      header: Object.assign({ 'content-type': 'application/json' }, options.header || {}),
      success(res) {
        const body = res.data || {}
        if (res.statusCode >= 200 && res.statusCode < 300 && body.success !== false) {
          resolve(body.data)
        } else {
          reject(new Error(body.message || '请求失败'))
        }
      },
      fail() { reject(new Error('网络不可用，请确认后端服务已启动')) }
    })
  })
}

function formatTime(value) {
  if (!value) return ''
  return String(value).replace('T', ' ').slice(0, 16)
}

Page({
  data: {
    activeTab: 'menu',
    categories: [],
    activeCategory: '',
    dishes: [],
    displayDishes: [],
    defaultDishUrl: '',
    basket: [],
    basketCount: 0,
    basketTotal: 0,
    basketVisible: false,
    orderVisible: false,
    customerName: '',
    orderRemark: '',
    orders: [],
    familyId: null,
    family: null,
    members: [],
    familyVisible: false,
    familyName: '',
    ownerName: '',
    memberName: '',
    loading: true,
    submitting: false,
    error: ''
  },

  onLoad() {
    const familyId = app.globalData.familyId
    this.setData({ familyId: familyId || null, defaultDishUrl: (app.globalData.apiBaseUrl || '') + '/default-dish.png' })
    this.loadMenu()
    this.loadOrders()
    if (familyId) this.loadFamily(familyId)
  },

  onPullDownRefresh() {
    Promise.all([this.loadMenu(), this.loadOrders()]).finally(() => wx.stopPullDownRefresh())
  },

  loadMenu() {
    this.setData({ loading: true, error: '' })
    return Promise.all([request('/api/dish-categories'), request('/api/dishes')])
      .then(([categories, dishes]) => {
        const list = categories || []
        const activeCategory = this.data.activeCategory || (list[0] && list[0].name) || ''
        this.setData({ categories: list, dishes: dishes || [], activeCategory: activeCategory }, this.refreshDisplayDishes)
      })
      .catch(err => this.setData({ error: err.message }))
      .finally(() => this.setData({ loading: false }))
  },

  loadOrders() {
    return request('/api/orders').then(orders => {
      const list = (orders || []).map(order => Object.assign({}, order, { displayTime: formatTime(order.createdAt), itemText: (order.items || []).map(item => item.dishName + ' × ' + item.quantity).join('、') }))
      this.setData({ orders: list })
    }).catch(err => this.setData({ error: err.message }))
  },

  loadFamily(id) {
    return Promise.all([request('/api/families/' + id), request('/api/families/' + id + '/members')])
      .then(([family, members]) => this.setData({ family: family, members: (members || []).map(member => Object.assign({}, member, { initial: (member.nickname || '?').substring(0, 1) })) }))
      .catch(() => {
        app.globalData.familyId = null
        wx.removeStorageSync('familyId')
        this.setData({ familyId: null, family: null, members: [] })
      })
  },

  switchTab(e) { this.setData({ activeTab: e.currentTarget.dataset.tab, basketVisible: false }) },
  selectCategory(e) { this.setData({ activeCategory: e.currentTarget.dataset.category }, this.refreshDisplayDishes) },
  refreshDisplayDishes() {
    const quantities = {}
    this.data.basket.forEach(item => { quantities[item.dishId] = item.quantity })
    const category = this.data.activeCategory
    this.setData({ displayDishes: this.data.dishes.filter(dish => !category || dish.category === category).map(dish => Object.assign({}, dish, { quantity: quantities[dish.id] || 0 })) })
  },

  addDish(e) { this.changeDish(e.currentTarget.dataset.id, 1) },
  increaseDish(e) { this.changeDish(e.currentTarget.dataset.id, 1) },
  decreaseDish(e) { this.changeDish(e.currentTarget.dataset.id, -1) },
  changeDish(id, delta) {
    const dishes = this.data.dishes
    const dish = dishes.find(item => Number(item.id) === Number(id))
    if (!dish) return
    const basket = this.data.basket.slice()
    const index = basket.findIndex(item => Number(item.dishId) === Number(id))
    if (index < 0 && delta > 0) basket.push({ dishId: dish.id, dishName: dish.name, quantity: 1, remark: '' })
    else if (index >= 0) {
      basket[index].quantity += delta
      if (basket[index].quantity <= 0) basket.splice(index, 1)
    }
    this.updateBasket(basket)
  },
  updateBasket(basket) {
    this.setData({ basket: basket, basketCount: basket.reduce((n, item) => n + item.quantity, 0), basketTotal: basket.reduce((n, item) => n + item.quantity, 0) }, this.refreshDisplayDishes)
  },
  openBasket() {
    if (!this.data.basket.length) return wx.showToast({ title: '先选几道菜吧', icon: 'none' })
    this.setData({ basketVisible: true })
  },
  closeBasket() { this.setData({ basketVisible: false }) },
  clearBasket() { this.updateBasket([]); this.closeBasket() },
  openOrder() {
    if (!this.data.basket.length) return wx.showToast({ title: '购物篮还是空的', icon: 'none' })
    this.setData({ basketVisible: false, orderVisible: true, customerName: this.data.customerName || wx.getStorageSync('customerName') || '' })
  },
  closeOrder() { this.setData({ orderVisible: false }) },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  submitOrder() {
    const customerName = (this.data.customerName || '').trim()
    if (!customerName) return wx.showToast({ title: '请填写点菜人', icon: 'none' })
    this.setData({ submitting: true })
    request('/api/orders', { method: 'POST', data: { customerName: customerName, items: this.data.basket, remark: this.data.orderRemark } })
      .then(() => {
        wx.setStorageSync('customerName', customerName)
        this.updateBasket([])
        this.setData({ orderVisible: false, activeTab: 'orders', orderRemark: '' })
        wx.showToast({ title: '订单已提交', icon: 'success' })
        return this.loadOrders()
      }).catch(err => wx.showToast({ title: err.message, icon: 'none' }))
      .finally(() => this.setData({ submitting: false }))
  },

  openFamily() { this.setData({ familyVisible: true }) },
  closeFamily() { this.setData({ familyVisible: false }) },
  createFamily() {
    const name = (this.data.familyName || '').trim()
    const ownerName = (this.data.ownerName || '').trim()
    if (!name || !ownerName) return wx.showToast({ title: '请填写家庭名和称呼', icon: 'none' })
    request('/api/families', { method: 'POST', data: { name: name, ownerName: ownerName } }).then(family => {
      app.globalData.familyId = family.id
      wx.setStorageSync('familyId', family.id)
      this.setData({ familyId: family.id, familyName: '', ownerName: '', familyVisible: false })
      return this.loadFamily(family.id)
    }).then(() => wx.showToast({ title: '家庭已创建', icon: 'success' })).catch(err => wx.showToast({ title: err.message, icon: 'none' }))
  },
  addMember() {
    const nickname = (this.data.memberName || '').trim()
    if (!this.data.familyId) return this.openFamily()
    if (!nickname) return wx.showToast({ title: '请填写成员称呼', icon: 'none' })
    request('/api/families/' + this.data.familyId + '/members', { method: 'POST', data: { nickname: nickname, role: 'MEMBER' } }).then(() => {
      this.setData({ memberName: '' }); return this.loadFamily(this.data.familyId)
    }).catch(err => wx.showToast({ title: err.message, icon: 'none' }))
  },
  removeMember(e) {
    const memberId = e.currentTarget.dataset.id
    wx.showModal({ title: '移除成员', content: '确认移除这个家庭成员吗？', success: res => {
      if (!res.confirm) return
      request('/api/families/' + this.data.familyId + '/members/' + memberId, { method: 'DELETE' }).then(() => this.loadFamily(this.data.familyId)).catch(err => wx.showToast({ title: err.message, icon: 'none' }))
    } })
  },
  dishImage(e) { e.detail && e.detail.errMsg && this.setData({}) }
  ,noop() {}
})
