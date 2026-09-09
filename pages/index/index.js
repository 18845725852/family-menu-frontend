const app = getApp()

function request(path, options) {
  options = options || {}
  return new Promise((resolve, reject) => {
    wx.request({
      url: (app.globalData.apiBaseUrl || '') + path,
      method: options.method || 'GET',
      data: options.data,
      timeout: 15000,
      enableHttp2: false,
      enableQuic: false,
      header: Object.assign({
        'content-type': 'application/json',
        ...(app.globalData.sessionToken ? { Authorization: 'Bearer ' + app.globalData.sessionToken } : {})
      }, options.header || {}),
      success(res) {
        const body = res.data || {}
        if (res.statusCode >= 200 && res.statusCode < 300 && body.success !== false) {
          resolve(body.data)
        } else {
          const detail = body.data && body.data.message
          const error = new Error(body.message || detail || (res.statusCode === 401 ? '登录已失效' : '请求失败'))
          error.statusCode = res.statusCode
          reject(error)
        }
      },
      fail(err) {
        const message = err && err.errMsg ? err.errMsg : '网络不可用，请确认后端服务已启动'
        console.error('[request failed]', path, message, err.errno)
        reject(new Error(message))
      }
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
    searchVisible: false,
    searchKeyword: '',
    dishes: [],
    displayDishes: [],
    defaultDishUrl: '',
    basket: [],
    basketCount: 0,
    basketTotal: 0,
    basketVisible: false,
    orderVisible: false,
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
    profileName: '',
    profileEditing: false,
    profileSaving: false,
    loginVisible: false,
    loginLoading: false,
    loginError: '',
    authReady: false,
    loading: true,
    submitting: false,
    error: ''
    ,previewImageVisible: false
    ,previewImageUrl: ''
  },

  onLoad() {
    const familyId = app.globalData.familyId
    this.setData({ familyId: familyId || null, defaultDishUrl: (app.globalData.apiBaseUrl || '') + '/default-dish.png', profileName: (app.globalData.currentUser && app.globalData.currentUser.nickname) || wx.getStorageSync('profileName') || '' })
    this.loadMenu()
    if (app.globalData.sessionToken && app.globalData.currentUser) {
      this.enterAfterLogin().catch(err => this.showLogin(err.message))
    } else {
      this.showLogin('')
    }
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
    if (this.data.authReady) this.loadOrders()
  },

  clearLogin() {
    app.globalData.sessionToken = null
    app.globalData.currentUser = null
    app.globalData.familyId = null
    app.globalData.family = null
    app.globalData.pendingBasket = []
    app.globalData.orderEditing = false
    app.globalData.orderSubmitted = false
    wx.removeStorageSync('sessionToken')
    wx.removeStorageSync('currentUser')
    wx.removeStorageSync('familyId')
    this.setData({
      activeTab: 'menu',
      familyId: null,
      family: null,
      families: [],
      members: [],
      orders: [],
      profileName: '',
      profileEditing: false,
      familyVisible: false,
      basketVisible: false
    })
    this.updateBasket([])
  },

  showLogin(message) {
    this.setData({ loginVisible: true, loginLoading: false, loginError: message || '', authReady: false, error: '' })
  },

  beginLogin() {
    if (this.data.loginLoading) return
    this.setData({ loginLoading: true, loginError: '' })
    this.loginWechat(true)
      .then(() => this.enterAfterLogin())
      .then(() => this.setData({ loginVisible: false, loginLoading: false, loginError: '' }))
      .catch(err => this.showLogin(err.message || '微信登录失败，请稍后重试'))
  },

  enterAfterLogin() {
    return this.loadFamilies().then(() => this.loadOrders()).then(() => {
      this.setData({ authReady: true, error: '' })
    })
  },

  loginWechat(force) {
    if (force) this.clearLogin()
    if (app.globalData.sessionToken && app.globalData.currentUser) return Promise.resolve(app.globalData.currentUser)
    if (this.loginPromise) return this.loginPromise
    this.loginPromise = new Promise((resolve, reject) => wx.login({
      success: login => {
        console.log('[wx.login success]', login)
        if (!login.code) return reject(new Error('微信登录未返回 code'))

        const loginUrl = (app.globalData.apiBaseUrl || '') + '/api/auth/wechat-login'
        console.log('[wechat-login request]', {
          url: loginUrl,
          codeLength: login.code.length
        })

        request('/api/auth/wechat-login', {
          method: 'POST',
          data: {
            code: login.code,
            nickname: wx.getStorageSync('profileName') || ''
          }
        }).then(user => {
          app.globalData.sessionToken = user.token
          app.globalData.currentUser = user
          this.setData({ profileName: user.nickname || '' })
          wx.setStorageSync('sessionToken', user.token)
          wx.setStorageSync('currentUser', user)
          resolve(user)
        }).catch(reject)
      },
      fail: err => {
        console.error('[wx.login fail]', err)
        reject(new Error((err && err.errMsg) || 'wx.login 调用失败'))
      }
    }))
    return this.loginPromise.finally(() => { this.loginPromise = null })
  },

  authRequest(path, options) {
    return this.loginWechat().then(() => request(path, options)).catch(err => {
      if (err.statusCode === 401) {
        this.clearLogin()
        this.showLogin('登录状态已失效，请重新登录')
        throw new Error('登录状态已失效，请重新登录')
      }
      throw err
    })
  },

  onPullDownRefresh() {
    Promise.all([this.loadMenu(), this.loadOrders()]).finally(() => wx.stopPullDownRefresh())
  },

  loadMenu() {
    this.setData({ loading: true, error: '' })
    return Promise.all([request('/api/dish-categories'), request('/api/dishes')])
      .then(([categories, dishes]) => {
        const list = (categories || []).map(category => {
          const name = category.name || ''
          return Object.assign({}, category, { line1: name.substring(0, 2), line2: name.substring(2) })
        })
        const activeCategory = this.data.activeCategory || (list[0] && list[0].name) || ''
        const normalizedDishes = (dishes || []).map(dish => Object.assign({}, dish, { imageUrl: resolveMediaUrl(dish.imageUrl) }))
        this.setData({ categories: list, dishes: normalizedDishes, activeCategory: activeCategory }, this.refreshDisplayDishes)
      })
      .catch(err => this.setData({ error: err.message }))
      .finally(() => this.setData({ loading: false }))
  },

  loadOrders() {
    if (!app.globalData.familyId) return Promise.resolve(this.setData({ orders: [] }))
    return this.authRequest('/api/families/' + app.globalData.familyId + '/orders').then(orders => {
      let previousDate = ''
      const list = (orders || []).map(order => {
        const displayTime = formatTime(order.createdAt)
        const dateLabel = displayTime ? displayTime.slice(0, 10) : '未知日期'
        const item = Object.assign({}, order, { displayTime: displayTime, displayClock: displayTime.length >= 16 ? displayTime.substring(11, 16) : '', dateLabel: dateLabel, showDate: dateLabel !== previousDate, itemText: (order.items || []).map(item => item.dishName + ' × ' + item.quantity).join('、'), displayItems: (order.items || []).map(orderItem => { const dish = this.data.dishes.find(d => Number(d.id) === Number(orderItem.dishId)); return Object.assign({}, orderItem, { imageUrl: dish ? dish.imageUrl : this.data.defaultDishUrl }) }) })
        previousDate = dateLabel
        return item
      })
      this.setData({ orders: list })
    }).catch(err => this.setData({ error: err.message }))
  },

  loadFamily(id) {
    return Promise.all([this.authRequest('/api/families/' + id), this.authRequest('/api/families/' + id + '/members')])
      .then(([family, members]) => this.setData({ family: family, members: (members || []).map(member => Object.assign({}, member, { initial: (member.nickname || '?').substring(0, 1) })) }))
      .catch(() => {
        app.globalData.familyId = null
        wx.removeStorageSync('familyId')
        this.setData({ familyId: null, family: null, members: [] })
      })
  },
  loadFamilies() {
    return this.authRequest('/api/families').then(families => {
      const list = families || []
      const storedId = Number(app.globalData.familyId)
      const storedFamily = list.find(item => Number(item.id) === storedId)
      const currentId = storedFamily ? storedFamily.id : (list[0] && list[0].id)
      if (currentId) {
        app.globalData.familyId = currentId
        wx.setStorageSync('familyId', currentId)
      } else {
        app.globalData.familyId = null
        wx.removeStorageSync('familyId')
      }
      this.setData({ families: list, familyId: currentId || null })
      if (currentId) return this.loadFamily(currentId)
      this.setData({ family: null, members: [], orders: [] })
    })
  },
  saveProfile() {
    const nickname = (this.data.profileName || '').trim()
    if (!nickname) return wx.showToast({ title: '请填写你的称呼', icon: 'none' })
    this.setData({ profileSaving: true })
    this.authRequest('/api/me/profile', { method: 'PUT', data: { nickname: nickname } }).then(user => {
      app.globalData.currentUser = Object.assign({}, app.globalData.currentUser, { nickname: user.nickname })
      wx.setStorageSync('currentUser', app.globalData.currentUser)
      wx.setStorageSync('profileName', nickname)
      return this.data.familyId
        ? Promise.all([this.loadFamily(this.data.familyId), this.loadOrders()])
        : Promise.resolve()
    }).then(() => { this.setData({ profileEditing: false }); wx.showToast({ title: '称呼已保存', icon: 'success' }) }).catch(err => wx.showToast({ title: err.message, icon: 'none' })).finally(() => this.setData({ profileSaving: false }))
  },
  editProfile() { this.setData({ profileEditing: true }) },
  cancelProfileEdit() { this.setData({ profileEditing: false, profileName: (app.globalData.currentUser && app.globalData.currentUser.nickname) || '' }) },
  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后将无法查看家庭和订单，确定退出吗？',
      confirmText: '退出',
      confirmColor: '#b25f50',
      success: res => {
        if (!res.confirm) return
        request('/api/auth/logout', { method: 'POST' }).catch(() => null).then(() => {
          this.clearLogin()
          this.showLogin('')
          wx.showToast({ title: '已退出登录', icon: 'success' })
        })
      }
    })
  },
  switchFamily(e) {
    const id = Number(e.currentTarget.dataset.id)
    app.globalData.familyId = id
    wx.setStorageSync('familyId', id)
    this.setData({ familyId: id })
    this.loadFamily(id); this.loadOrders()
  },

  switchTab(e) { this.setData({ activeTab: e.currentTarget.dataset.tab, basketVisible: false }) },
  goWheel() { wx.navigateTo({ url: '/pages/wheel/wheel' }) },
  toggleSearch() {
    const visible = !this.data.searchVisible
    this.setData({ searchVisible: visible, searchKeyword: visible ? this.data.searchKeyword : '' }, this.refreshDisplayDishes)
  },
  inputSearch(e) {
    this.setData({ searchKeyword: e.detail.value }, this.refreshDisplayDishes)
  },
  clearSearch() {
    this.setData({ searchKeyword: '' }, this.refreshDisplayDishes)
  },
  selectCategory(e) { this.setData({ activeCategory: e.currentTarget.dataset.category }, this.refreshDisplayDishes) },
  refreshDisplayDishes() {
    const quantities = {}
    this.data.basket.forEach(item => { quantities[item.dishId] = item.quantity })
    const category = this.data.activeCategory
    const keyword = (this.data.searchKeyword || '').trim().toLowerCase()
    const list = this.data.dishes.filter(dish => {
      const matchesCategory = !category || dish.category === category
      const matchesKeyword = !keyword || String(dish.name || '').toLowerCase().indexOf(keyword) >= 0
      return matchesCategory && matchesKeyword
    })
    this.setData({ displayDishes: list.map(dish => Object.assign({}, dish, { quantity: quantities[dish.id] || 0 })) })
  },

  addDish(e) { this.changeDish(e.currentTarget.dataset.id, 1) },
  previewDishImage(e) {
    const url = e.currentTarget.dataset.image
    if (!url) return
    this.setData({ previewImageVisible: true, previewImageUrl: url })
  },
  closePreviewImage() { this.setData({ previewImageVisible: false, previewImageUrl: '' }) },
  increaseDish(e) { this.changeDish(e.currentTarget.dataset.id, 1) },
  decreaseDish(e) { this.changeDish(e.currentTarget.dataset.id, -1) },
  changeDish(id, delta) {
    const dishes = this.data.dishes
    const dish = dishes.find(item => Number(item.id) === Number(id))
    if (!dish) return
    const basket = this.data.basket.slice()
    const index = basket.findIndex(item => Number(item.dishId) === Number(id))
    if (index < 0 && delta > 0) basket.push({ dishId: dish.id, dishName: dish.name, imageUrl: dish.imageUrl, quantity: 1, remark: '' })
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
    if (!app.globalData.familyId) {
      return wx.showModal({
        title: '先建立家庭菜单',
        content: '创建或加入家庭后才能下单，订单只会展示给同一家庭的成员。',
        confirmText: '去创建',
        cancelText: '继续浏览',
        success: res => {
          if (res.confirm) this.setData({ activeTab: 'family', familyVisible: true, basketVisible: false })
        }
      })
    }
    app.globalData.pendingBasket = this.data.basket.map(item => Object.assign({}, item))
    app.globalData.orderEditing = true
    this.setData({ basketVisible: false })
    wx.navigateTo({ url: '/pages/order/order' })
  },
  closeOrder() { this.setData({ orderVisible: false }) },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  submitOrder() {
    if (!app.globalData.familyId) return wx.showToast({ title: '请先创建或加入家庭', icon: 'none' })
    this.setData({ submitting: true })
    this.authRequest('/api/families/' + app.globalData.familyId + '/orders', { method: 'POST', data: { items: this.data.basket, remark: this.data.orderRemark } })
      .then(() => {
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
    if (!name) return wx.showToast({ title: '请填写家庭名称', icon: 'none' })
    this.authRequest('/api/families', { method: 'POST', data: { name: name } }).then(family => {
      app.globalData.familyId = family.id
      wx.setStorageSync('familyId', family.id)
      this.setData({ familyId: family.id, familyName: '', familyVisible: false })
      return this.loadFamilies()
    }).then(() => wx.showToast({ title: '家庭已创建', icon: 'success' })).catch(err => wx.showToast({ title: err.message, icon: 'none' }))
  },
  createInviteCode() {
    if (!this.data.familyId) return wx.showToast({ title: '请先创建家庭', icon: 'none' })
    this.authRequest('/api/families/' + this.data.familyId + '/invite-code', { method: 'POST' }).then(result => {
      this.setData({ inviteCode: result.inviteCode })
      wx.setClipboardData({ data: result.inviteCode })
      wx.showToast({ title: '邀请码已复制', icon: 'success' })
    }).catch(err => wx.showToast({ title: err.message, icon: 'none' }))
  },
  joinFamily() {
    const code = (this.data.joinCode || '').trim()
    if (!code) return wx.showToast({ title: '请输入邀请码', icon: 'none' })
    this.authRequest('/api/family-invitations/join', { method: 'POST', data: { inviteCode: code } }).then(family => {
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
      this.authRequest('/api/families/' + this.data.familyId + '/members/' + memberId, { method: 'DELETE' }).then(() => this.loadFamily(this.data.familyId)).catch(err => wx.showToast({ title: err.message, icon: 'none' }))
    } })
  },
  dishImage(e) { e.detail && e.detail.errMsg && this.setData({}) }
  ,noop() {}
})
