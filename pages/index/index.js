const app = getApp()

function request(path, options) {
  options = options || {}
  return new Promise((resolve, reject) => {
    wx.request({
      url: (app.globalData.apiBaseUrl || '') + path,
      method: options.method || 'GET',
      data: options.data,
      header: Object.assign({
        'content-type': 'application/json',
        ...(app.globalData.sessionToken ? { Authorization: 'Bearer ' + app.globalData.sessionToken } : {})
      }, options.header || {}),
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

function resolveMediaUrl(value) {
  if (!value) return ''
  if (/^https?:\/\//.test(value)) return value
  return (app.globalData.apiBaseUrl || '') + (value.charAt(0) === '/' ? value : '/' + value)
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
    families: [],
    inviteCode: '',
    joinCode: '',
    members: [],
    familyVisible: false,
    familyName: '',
    ownerName: '',
    profileName: '',
    profileEditing: false,
    profileSaving: false,
    loading: true,
    submitting: false,
    error: ''
  },

  onLoad() {
    const familyId = app.globalData.familyId
    this.setData({ familyId: familyId || null, defaultDishUrl: (app.globalData.apiBaseUrl || '') + '/default-dish.png', profileName: (app.globalData.currentUser && app.globalData.currentUser.nickname) || wx.getStorageSync('profileName') || '' })
    this.loadMenu()
    this.loginWechat().then(() => {
      this.loadFamilies()
      this.loadOrders()
      if (app.globalData.familyId) this.loadFamily(app.globalData.familyId)
    })
  },

  onShow() {
    if (app.globalData.orderSubmitted) {
      app.globalData.orderSubmitted = false
      app.globalData.pendingBasket = []
      this.updateBasket([])
      this.setData({ basketVisible: false })
    } else if (app.globalData.orderEditing) {
      this.updateBasket(app.globalData.pendingBasket || [])
      app.globalData.orderEditing = false
    }
    this.loadOrders()
  },

  loginWechat() {
    if (app.globalData.sessionToken && app.globalData.currentUser) return Promise.resolve(app.globalData.currentUser)
    return new Promise((resolve, reject) => wx.login({ success: login => {
      if (!login.code) return reject(new Error('微信登录失败'))
      request('/api/auth/wechat-login', { method: 'POST', data: { code: login.code, nickname: wx.getStorageSync('profileName') || '' } })
        .then(user => {
          app.globalData.sessionToken = user.token
          app.globalData.currentUser = user
          this.setData({ profileName: user.nickname || '' })
          wx.setStorageSync('sessionToken', user.token)
          wx.setStorageSync('currentUser', user)
          resolve(user)
        }).catch(reject)
    }, fail: reject }))
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
        const normalizedDishes = (dishes || []).map(dish => Object.assign({}, dish, { imageUrl: resolveMediaUrl(dish.imageUrl) }))
        this.setData({ categories: list, dishes: normalizedDishes, activeCategory: activeCategory }, this.refreshDisplayDishes)
      })
      .catch(err => this.setData({ error: err.message }))
      .finally(() => this.setData({ loading: false }))
  },

  loadOrders() {
    if (!app.globalData.familyId) return Promise.resolve(this.setData({ orders: [] }))
    return request('/api/families/' + app.globalData.familyId + '/orders').then(orders => {
      let previousDate = ''
      const list = (orders || []).map(order => {
        const displayTime = formatTime(order.createdAt)
        const dateLabel = displayTime ? displayTime.slice(0, 10) : '未知日期'
        const item = Object.assign({}, order, { displayTime: displayTime, displayClock: displayTime.length >= 16 ? displayTime.substring(11, 16) : '', dateLabel: dateLabel, showDate: dateLabel !== previousDate, itemText: (order.items || []).map(item => item.dishName + ' × ' + item.quantity).join('、') })
        previousDate = dateLabel
        return item
      })
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
  loadFamilies() {
    return request('/api/families').then(families => {
      const list = families || []
      const currentId = app.globalData.familyId || (list[0] && list[0].id)
      if (currentId && !app.globalData.familyId) { app.globalData.familyId = currentId; wx.setStorageSync('familyId', currentId) }
      this.setData({ families: list, familyId: currentId || null })
      if (currentId) return this.loadFamily(currentId)
    }).catch(err => this.setData({ error: err.message }))
  },
  saveProfile() {
    const nickname = (this.data.profileName || '').trim()
    if (!nickname) return wx.showToast({ title: '请填写你的称呼', icon: 'none' })
    this.setData({ profileSaving: true })
    request('/api/me/profile', { method: 'PUT', data: { nickname: nickname } }).then(user => {
      app.globalData.currentUser = Object.assign({}, app.globalData.currentUser, { nickname: user.nickname })
      wx.setStorageSync('currentUser', app.globalData.currentUser)
      wx.setStorageSync('profileName', nickname)
      return this.data.familyId ? this.loadFamily(this.data.familyId) : Promise.resolve()
    }).then(() => { this.setData({ profileEditing: false }); wx.showToast({ title: '称呼已保存', icon: 'success' }) }).catch(err => wx.showToast({ title: err.message, icon: 'none' })).finally(() => this.setData({ profileSaving: false }))
  },
  editProfile() { this.setData({ profileEditing: true }) },
  cancelProfileEdit() { this.setData({ profileEditing: false, profileName: (app.globalData.currentUser && app.globalData.currentUser.nickname) || '' }) },
  switchFamily(e) {
    const id = Number(e.currentTarget.dataset.id)
    app.globalData.familyId = id
    wx.setStorageSync('familyId', id)
    this.setData({ familyId: id })
    this.loadFamily(id); this.loadOrders()
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
    const selected = this.data.dishes.filter(dish => dish.quantity > 0).map(dish => ({
      dishId: dish.id,
      dishName: dish.name,
      quantity: dish.quantity,
      remark: ''
    }))
    const basket = selected.length ? selected : this.data.basket
    if (!basket.length) return wx.showToast({ title: '先选几道菜吧', icon: 'none' })
    this.setData({ basket: basket, basketCount: basket.reduce((n, item) => n + item.quantity, 0), basketTotal: basket.reduce((n, item) => n + item.quantity, 0), basketVisible: true })
  },
  closeBasket() { this.setData({ basketVisible: false }) },
  clearBasket() { this.updateBasket([]); this.closeBasket() },
  openOrder() {
    if (!this.data.basket.length) return wx.showToast({ title: '购物篮还是空的', icon: 'none' })
    app.globalData.pendingBasket = this.data.basket.map(item => Object.assign({}, item))
    app.globalData.orderEditing = true
    this.setData({ basketVisible: false })
    wx.navigateTo({ url: '/pages/order/order' })
  },
  closeOrder() { this.setData({ orderVisible: false }) },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  submitOrder() {
    const customerName = (this.data.customerName || '').trim()
    if (!customerName) return wx.showToast({ title: '请填写点菜人', icon: 'none' })
    this.setData({ submitting: true })
    if (!app.globalData.familyId) return wx.showToast({ title: '请先创建或加入家庭', icon: 'none' })
    request('/api/families/' + app.globalData.familyId + '/orders', { method: 'POST', data: { customerName: customerName, items: this.data.basket, remark: this.data.orderRemark } })
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
      return this.loadFamilies()
    }).then(() => wx.showToast({ title: '家庭已创建', icon: 'success' })).catch(err => wx.showToast({ title: err.message, icon: 'none' }))
  },
  createInviteCode() {
    if (!this.data.familyId) return wx.showToast({ title: '请先创建家庭', icon: 'none' })
    request('/api/families/' + this.data.familyId + '/invite-code', { method: 'POST' }).then(result => {
      this.setData({ inviteCode: result.inviteCode })
      wx.setClipboardData({ data: result.inviteCode })
      wx.showToast({ title: '邀请码已复制', icon: 'success' })
    }).catch(err => wx.showToast({ title: err.message, icon: 'none' }))
  },
  joinFamily() {
    const code = (this.data.joinCode || '').trim()
    if (!code) return wx.showToast({ title: '请输入邀请码', icon: 'none' })
    request('/api/family-invitations/join', { method: 'POST', data: { inviteCode: code } }).then(family => {
      app.globalData.familyId = family.id
      wx.setStorageSync('familyId', family.id)
      this.setData({ joinCode: '' })
      return this.loadFamilies()
    }).then(() => wx.showToast({ title: '已加入家庭', icon: 'success' })).catch(err => wx.showToast({ title: err.message, icon: 'none' }))
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
