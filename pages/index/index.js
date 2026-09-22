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

function parseRecipe(recipe) {
  if (!recipe) return []
  return String(recipe).split(/\n+/).map(function (line) {
    return line.replace(/^\s*\d+[.、\)]\s*/, '').trim()
  }).filter(Boolean)
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
    dishSections: [],
    scrollIntoView: '',
    scrollAnimated: false,
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
    joinPreview: null,
    joinLooking: false,
    members: [],
    familyVisible: false,
    familyName: '',
    profileName: '',
    profileEditing: false,
    profileSaving: false,
    loginVisible: false,
    loginLoading: false,
    loginError: '',
    loginPurpose: '登录后可以查看家庭组订单、管理家庭组并提交菜单',
    loggedIn: false,
    authReady: false,
    loading: true,
    submitting: false,
    error: '',
    previewImageVisible: false,
    previewImageUrl: '',
    headerTop: 98,
    profileAvatarUrl: '',
    defaultAvatarUrl: '/assets/default-avatar.jpg',
    avatarSaving: false,
    customMenu: false,
    editMode: false,
    dishEditorVisible: false,
    editorDishId: null,
    editorName: '',
    editorCategory: '',
    editorDescription: '',
    editorRecipe: '',
    editorSort: '0',
    editorImageUrl: '',
    editorImagePreview: '',
    editorSaving: false
  },

  onLoad() {
    const familyId = app.globalData.familyId
    const loggedIn = this.isLoggedIn()
    const navMetrics = app.getNavMetrics ? app.getNavMetrics() : app.globalData.navMetrics
    const headerTop = (navMetrics && navMetrics.headerTop) || this.data.headerTop
    this.setData({
      familyId: familyId || null,
      loggedIn: loggedIn,
      headerTop: headerTop,
      defaultDishUrl: (app.globalData.apiBaseUrl || '') + '/default-dish.png',
      profileName: (app.globalData.currentUser && app.globalData.currentUser.nickname) || wx.getStorageSync('profileName') || '',
      profileAvatarUrl: resolveMediaUrl((app.globalData.currentUser && app.globalData.currentUser.avatarUrl) || '')
    })
    this.loadMenu()
    if (loggedIn) {
      this.enterAfterLogin().catch(() => this.clearLogin())
    }
  },

  onShareAppMessage() {
    return {
      title: '今晚吃什么？一起选菜吧',
      path: '/pages/index/index'
    }
  },

  onShareTimeline() {
    return {
      title: '今晚吃什么？一起选菜吧',
      query: ''
    }
  },

  onShow() {
    if (app.globalData.openFamilyTab) {
      app.globalData.openFamilyTab = false
      this.setData({ activeTab: 'family', basketVisible: false })
      if (app.globalData.openLogin && !this.isLoggedIn()) {
        app.globalData.openLogin = false
        this.showLogin('', '登录后可以自定义自己的转盘', 'family')
      } else {
        app.globalData.openLogin = false
      }
    }
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
    this.inviteCodes = {}
    this.setData({
      activeTab: 'menu',
      familyId: null,
      family: null,
      families: [],
      members: [],
      orders: [],
      profileName: '',
      profileAvatarUrl: '',
      profileEditing: false,
      familyVisible: false,
      basketVisible: false,
      inviteCode: '',
      loggedIn: false,
      authReady: false,
      loginLoading: false,
      loginError: '',
      customMenu: false,
      editMode: false
    })
    this.updateBasket([])
    this.loadMenu()
  },

  showLogin(message, purpose, nextAction) {
    this.pendingAfterLogin = nextAction || null
    this.setData({
      loginVisible: true,
      loginLoading: false,
      loginError: message || '',
      loginPurpose: purpose || '登录后可以查看家庭组订单、管理家庭组并提交菜单',
      authReady: false,
      error: ''
    })
  },

  closeLogin() {
    if (this.data.loginLoading) return
    this.pendingAfterLogin = null
    this.setData({ loginVisible: false, loginError: '' })
  },

  beginLogin() {
    if (this.data.loginLoading) return
    this.setData({ loginLoading: true, loginError: '' })
    this.loginWechat(false)
      .then(() => this.enterAfterLogin())
      .then(() => {
        const nextAction = this.pendingAfterLogin
        this.pendingAfterLogin = null
        this.setData({ loginVisible: false, loginLoading: false, loginError: '' })
        if (nextAction === 'orders' || nextAction === 'family') {
          this.setData({ activeTab: nextAction, basketVisible: false })
        } else if (nextAction === 'order') {
          this.continueOpenOrder()
        }
      })
      .catch(err => this.setData({ loginLoading: false, loginError: err.message || '微信登录失败，请稍后重试' }))
  },

  enterAfterLogin() {
    return this.loadFamilies().then(() => this.loadOrders()).then(() => {
      this.setData({ authReady: true, loggedIn: true, error: '' })
    })
  },

  isLoggedIn() {
    return !!(app.globalData.sessionToken && app.globalData.currentUser)
  },

  goLogin() {
    this.setData({ activeTab: 'family', basketVisible: false, loginError: '' })
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
          this.setData({
            profileName: user.nickname || '',
            profileAvatarUrl: resolveMediaUrl(user.avatarUrl || '')
          })
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
    const tasks = [this.loadMenu()]
    if (this.isLoggedIn()) tasks.push(this.loadOrders())
    Promise.all(tasks).finally(() => wx.stopPullDownRefresh())
  },

  loadMenu() {
    this.setData({ loading: true, error: '' })
    const familyId = this.isLoggedIn() ? app.globalData.familyId : null
    const menuRequest = familyId
      ? this.authRequest('/api/families/' + familyId + '/menu')
      : request('/api/dishes').then(dishes => ({ customMenu: false, dishes: dishes || [] }))
    return Promise.all([request('/api/dish-categories'), menuRequest])
      .then(([categories, menu]) => {
        const list = (categories || []).map(category => {
          const name = category.name || ''
          return Object.assign({}, category, { line1: name.substring(0, 2), line2: name.substring(2) })
        })
        const activeCategory = this.data.activeCategory || (list[0] && list[0].name) || ''
        const customMenu = !!(menu && menu.customMenu)
        const normalizedDishes = ((menu && menu.dishes) || []).map(dish => Object.assign({}, dish, {
          imageUrl: resolveMediaUrl(dish.imageUrl),
          recipeSteps: parseRecipe(dish.recipe)
        }))
        const sameMenu = customMenu === this.data.customMenu
        const basket = sameMenu ? this.data.basket : []
        this.setData({
          categories: list,
          dishes: normalizedDishes,
          activeCategory: activeCategory,
          customMenu: customMenu,
          editMode: customMenu ? this.data.editMode : false,
          basket: basket,
          basketCount: basket.length,
          basketTotal: basket.length
        }, this.refreshDisplayDishes)
      })
      .catch(err => this.setData({ error: err.message }))
      .finally(() => this.setData({ loading: false }))
  },

  loadOrders() {
    if (!this.isLoggedIn() || !app.globalData.familyId) return Promise.resolve(this.setData({ orders: [] }))
    return this.authRequest('/api/families/' + app.globalData.familyId + '/orders').then(orders => {
      let previousDate = ''
      const list = (orders || []).map(order => {
        const displayTime = formatTime(order.createdAt)
        const dateLabel = displayTime ? displayTime.slice(0, 10) : '未知日期'
        const item = Object.assign({}, order, { displayTime: displayTime, displayClock: displayTime.length >= 16 ? displayTime.substring(11, 16) : '', dateLabel: dateLabel, showDate: dateLabel !== previousDate, customerAvatarUrl: resolveMediaUrl(order.customerAvatarUrl || ''), itemText: (order.items || []).map(item => item.dishName + ' × ' + item.quantity).join('、'), displayItems: (order.items || []).map(orderItem => { const dish = this.data.dishes.find(d => Number(d.id) === Number(orderItem.dishId)); return Object.assign({}, orderItem, { imageUrl: dish ? dish.imageUrl : this.data.defaultDishUrl }) }) })
        previousDate = dateLabel
        return item
      })
      this.setData({ orders: list })
    }).catch(err => this.setData({ error: err.message }))
  },

  loadFamily(id) {
    return Promise.all([this.authRequest('/api/families/' + id), this.authRequest('/api/families/' + id + '/members')])
      .then(([family, members]) => this.setData({
        family: family,
        members: (members || []).map(member => Object.assign({}, member, {
          initial: (member.nickname || '?').substring(0, 1),
          avatarUrl: resolveMediaUrl(member.avatarUrl || '')
        })),
        inviteCode: (this.inviteCodes && this.inviteCodes[id]) || ''
      }))
      .catch(() => {
        app.globalData.familyId = null
        wx.removeStorageSync('familyId')
        this.setData({ familyId: null, family: null, members: [], inviteCode: '' })
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
      const follow = currentId ? this.loadFamily(currentId) : Promise.resolve(this.setData({ family: null, members: [], orders: [], inviteCode: '' }))
      return follow.then(() => this.loadMenu())
    })
  },
  saveProfile() {
    const nickname = (this.data.profileName || '').trim()
    if (!nickname) return wx.showToast({ title: '请填写你的称呼', icon: 'none' })
    this.setData({ profileSaving: true })
    this.authRequest('/api/me/profile', { method: 'PUT', data: { nickname: nickname } }).then(user => {
      app.globalData.currentUser = Object.assign({}, app.globalData.currentUser, { nickname: user.nickname, avatarUrl: user.avatarUrl || (app.globalData.currentUser && app.globalData.currentUser.avatarUrl) || '' })
      wx.setStorageSync('currentUser', app.globalData.currentUser)
      wx.setStorageSync('profileName', nickname)
      return this.data.familyId
        ? Promise.all([this.loadFamily(this.data.familyId), this.loadOrders()])
        : Promise.resolve()
    }).then(() => { this.setData({ profileEditing: false }); wx.showToast({ title: '称呼已保存', icon: 'success' }) }).catch(err => wx.showToast({ title: err.message, icon: 'none' })).finally(() => this.setData({ profileSaving: false }))
  },
  editProfile() { this.setData({ profileEditing: true }) },
  cancelProfileEdit() { this.setData({ profileEditing: false, profileName: (app.globalData.currentUser && app.globalData.currentUser.nickname) || '' }) },
  onChooseAvatar(e) {
    const tempPath = e.detail && e.detail.avatarUrl
    if (!tempPath) return
    if (!this.isLoggedIn()) {
      return this.showLogin('', '登录后才能保存微信头像', 'family')
    }
    if (this.data.avatarSaving) return
    this.setData({ avatarSaving: true })
    const saveAvatar = (avatarUrl) => {
      const nickname = (this.data.profileName || '').trim() || (app.globalData.currentUser && app.globalData.currentUser.nickname) || '微信用户'
      return this.authRequest('/api/me/profile', { method: 'PUT', data: { nickname: nickname, avatarUrl: avatarUrl } }).then(user => {
        const resolved = resolveMediaUrl((user && user.avatarUrl) || avatarUrl)
        app.globalData.currentUser = Object.assign({}, app.globalData.currentUser, {
          nickname: (user && user.nickname) || nickname,
          avatarUrl: (user && user.avatarUrl) || avatarUrl
        })
        wx.setStorageSync('currentUser', app.globalData.currentUser)
        this.setData({ profileName: (user && user.nickname) || nickname, profileAvatarUrl: resolved })
        return this.data.familyId ? this.loadFamily(this.data.familyId) : Promise.resolve()
      })
    }
    const finish = (ok, message) => {
      this.setData({ avatarSaving: false })
      wx.showToast({ title: ok ? '头像已更新' : (message || '保存头像失败'), icon: ok ? 'success' : 'none' })
    }
    if (/^https:\/\//.test(tempPath)) {
      saveAvatar(tempPath).then(() => finish(true)).catch(err => finish(false, err.message))
      return
    }
    wx.uploadFile({
      url: (app.globalData.apiBaseUrl || '') + '/api/uploads/image',
      filePath: tempPath,
      name: 'file',
      formData: { category: 'avatars' },
      header: app.globalData.sessionToken ? { Authorization: 'Bearer ' + app.globalData.sessionToken } : {},
      success: (res) => {
        let body = {}
        try { body = JSON.parse(res.data || '{}') } catch (err) { body = {} }
        if (res.statusCode >= 200 && res.statusCode < 300 && body.success !== false && body.data) {
          saveAvatar(body.data).then(() => finish(true)).catch(err => finish(false, err.message))
        } else {
          finish(false, (body && body.message) || '上传头像失败')
        }
      },
      fail: () => finish(false, '上传头像失败')
    })
  },
  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后将无法查看家庭组和订单，确定退出吗？',
      confirmText: '退出',
      confirmColor: '#b25f50',
      success: res => {
        if (!res.confirm) return
        request('/api/auth/logout', { method: 'POST' }).catch(() => null).then(() => {
          this.clearLogin()
          this.setData({ loginVisible: false })
          wx.showToast({ title: '已退出登录', icon: 'success' })
        })
      }
    })
  },
  switchFamily(e) {
    const id = Number(e.currentTarget.dataset.id)
    if (id === this.data.familyId) return
    app.globalData.familyId = id
    wx.setStorageSync('familyId', id)
    this.setData({
      familyId: id,
      editMode: false,
      inviteCode: (this.inviteCodes && this.inviteCodes[id]) || ''
    })
    this.updateBasket([])
    this.loadFamily(id)
    this.loadOrders()
    this.loadMenu()
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({
      activeTab: tab,
      basketVisible: false,
      scrollIntoView: '',
      scrollAnimated: false
    })
  },
  goWheel() { wx.navigateTo({ url: '/pages/wheel/wheel' }) },
  toggleSearch() {
    const visible = !this.data.searchVisible
    this.setData({ searchVisible: visible, searchKeyword: visible ? this.data.searchKeyword : '' }, this.refreshDisplayDishes)
  },
  inputSearch(e) {
    this.setData({ searchKeyword: e.detail.value }, () => this.refreshDisplayDishes(true))
  },
  clearSearch() {
    this.setData({ searchKeyword: '' }, () => this.refreshDisplayDishes(true))
  },
  selectCategory(e) {
    const target = 'dish-section-' + e.currentTarget.dataset.id
    this.setData({ activeCategory: e.currentTarget.dataset.category, scrollIntoView: '', scrollAnimated: true }, () => {
      this.setData({ scrollIntoView: target })
    })
  },
  onDishScroll(e) {
    if (!this.sectionOffsets || !this.sectionOffsets.length) return
    const scrollTop = e.detail.scrollTop + 24
    let active = this.sectionOffsets[0]
    this.sectionOffsets.forEach(section => {
      if (section.top <= scrollTop) active = section
    })
    if (active && active.name !== this.data.activeCategory) this.setData({ activeCategory: active.name })
  },
  measureDishSections() {
    const query = wx.createSelectorQuery().in(this)
    query.select('.dish-scroll').boundingClientRect()
    query.select('.dish-scroll').scrollOffset()
    query.selectAll('.dish-section').boundingClientRect()
    query.exec(result => {
      const viewport = result[0]
      const scroll = result[1]
      const sections = result[2] || []
      if (!viewport || !scroll) return
      this.sectionOffsets = sections.map((section, index) => ({
        name: this.data.dishSections[index] && this.data.dishSections[index].name,
        top: scroll.scrollTop + section.top - viewport.top
      }))
    })
  },
  refreshDisplayDishes(resetScroll) {
    const quantities = {}
    this.data.basket.forEach(item => { quantities[item.dishId] = item.quantity })
    const keyword = (this.data.searchKeyword || '').trim().toLowerCase()
    const list = this.data.dishes
      .filter(dish => !keyword || String(dish.name || '').toLowerCase().indexOf(keyword) >= 0)
      .map(dish => Object.assign({}, dish, { quantity: quantities[dish.id] || 0 }))
    const sections = this.data.categories.map(category => ({
      id: category.id,
      name: category.name,
      dishes: list.filter(dish => dish.category === category.name)
    })).filter(section => section.dishes.length)
    this.setData({ displayDishes: list, dishSections: sections }, () => {
      this.measureDishSections()
      if (resetScroll && sections.length) {
        this.setData({ activeCategory: sections[0].name, scrollIntoView: '' }, () => {
          this.setData({ scrollIntoView: 'dish-section-' + sections[0].id })
        })
      }
    })
  },

  addDish(e) { this.changeDish(e.currentTarget.dataset.id, 1) },
  previewDishImage(e) {
    const url = e.currentTarget.dataset.image
    if (!url) return
    this.setData({ previewImageVisible: true, previewImageUrl: url })
  },
  closePreviewImage() { this.setData({ previewImageVisible: false, previewImageUrl: '' }) },
  openDishDetail(e) {
    const id = Number(e.currentTarget.dataset.id)
    const dish = this.data.displayDishes.find(item => Number(item.id) === id) || this.data.dishes.find(item => Number(item.id) === id)
    if (!dish) return
    this.setData({ dishDetailVisible: true, dishDetail: dish })
  },
  closeDishDetail() { this.setData({ dishDetailVisible: false }) },
  addDishFromDetail() {
    if (!this.data.dishDetail) return
    this.changeDish(this.data.dishDetail.id, 1)
    this.setData({ dishDetailVisible: false })
    wx.showToast({ title: '已加入菜单', icon: 'success' })
  },
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
    this.setData({ basket: basket, basketCount: basket.length, basketTotal: basket.length }, this.refreshDisplayDishes)
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
    this.setData({ basket: basket, basketCount: basket.length, basketTotal: basket.length, basketVisible: true })
  },
  closeBasket() { this.setData({ basketVisible: false }) },
  clearBasket() { this.updateBasket([]); this.closeBasket() },
  openOrder() {
    if (!this.data.basket.length) return wx.showToast({ title: '购物篮还是空的', icon: 'none' })
    if (!this.isLoggedIn()) {
      return this.showLogin('', '登录后才能把已选菜品提交给你的家庭组', 'order')
    }
    this.continueOpenOrder()
  },
  continueOpenOrder() {
    if (!app.globalData.familyId) {
      return wx.showModal({
        title: '先建立家庭组菜单',
        content: '创建或加入家庭组后才能下单，订单只会展示给同一家庭组的成员。',
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

  toggleEditMode(e) {
    this.setData({ editMode: !!(e.detail && e.detail.value) })
  },
  toggleCustomMenu(e) {
    const enabled = !!(e.detail && e.detail.value)
    if (!this.isLoggedIn() || !app.globalData.familyId) {
      this.setData({ customMenu: false })
      return this.showLogin('', '登录后才能自定义菜谱', 'menu')
    }
    wx.showLoading({ title: enabled ? '正在准备家庭菜谱' : '正在切回默认菜谱', mask: true })
    this.authRequest('/api/families/' + app.globalData.familyId + '/menu', { method: 'PUT', data: { customMenu: enabled } })
      .then(menu => {
        const normalizedDishes = ((menu && menu.dishes) || []).map(dish => Object.assign({}, dish, {
          imageUrl: resolveMediaUrl(dish.imageUrl),
          recipeSteps: parseRecipe(dish.recipe)
        }))
        const enabled = !!menu.customMenu
        this.setData({ customMenu: enabled, editMode: enabled ? this.data.editMode : false, dishes: normalizedDishes, basket: [], basketCount: 0, basketTotal: 0 }, this.refreshDisplayDishes)
      })
      .catch(err => {
        this.setData({ customMenu: !enabled })
        wx.showToast({ title: err.message, icon: 'none' })
      })
      .finally(() => wx.hideLoading())
  },
  openDishEditor(e) {
    if (!this.data.customMenu || !this.data.editMode) return
    const id = e && e.currentTarget && e.currentTarget.dataset ? Number(e.currentTarget.dataset.id) : null
    const dish = id ? this.data.dishes.find(item => Number(item.id) === id) : null
    this.setData({
      dishEditorVisible: true,
      editorDishId: dish ? dish.id : null,
      editorName: dish ? dish.name : '',
      editorCategory: dish ? dish.category : ((this.data.categories[0] && this.data.categories[0].name) || ''),
      editorDescription: dish && dish.description ? dish.description : '',
      editorRecipe: dish && dish.recipe ? dish.recipe : '',
      editorSort: dish ? String(dish.sort || 0) : '0',
      editorImageUrl: dish && dish.imageUrl ? dish.imageUrl : '',
      editorImagePreview: dish && dish.imageUrl ? dish.imageUrl : ''
    })
  },
  closeDishEditor() { this.setData({ dishEditorVisible: false }) },
  chooseEditorCategory(e) {
    const category = this.data.categories[Number(e.detail.value)]
    if (category) this.setData({ editorCategory: category.name })
  },
  chooseEditorImage() {
    const uploadPath = (path) => {
      if (!path) return
      if (!app.globalData.familyId) return wx.showToast({ title: '请先进入家庭组', icon: 'none' })
      wx.showLoading({ title: '正在上传', mask: true })
      wx.uploadFile({
        url: (app.globalData.apiBaseUrl || '') + '/api/uploads/image',
        filePath: path,
        name: 'file',
        formData: { category: 'family', familyId: String(app.globalData.familyId) },
        header: app.globalData.sessionToken ? { Authorization: 'Bearer ' + app.globalData.sessionToken } : {},
        success: upload => {
          wx.hideLoading()
          let body = {}
          try { body = JSON.parse(upload.data || '{}') } catch (err) { body = {} }
          if (upload.statusCode >= 200 && upload.statusCode < 300 && body.success !== false && body.data) {
            this.setData({ editorImageUrl: body.data, editorImagePreview: resolveMediaUrl(body.data) })
          } else wx.showToast({ title: (body.data && body.data.message) || body.message || '上传图片失败', icon: 'none' })
        },
        fail: () => {
          wx.hideLoading()
          wx.showToast({ title: '上传图片失败', icon: 'none' })
        }
      })
    }
    const options = {
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: res => {
        const file = res.tempFiles && res.tempFiles[0]
        uploadPath((file && file.tempFilePath) || (res.tempFilePaths && res.tempFilePaths[0]))
      },
      fail: () => wx.showToast({ title: '未选择图片', icon: 'none' })
    }
    if (wx.chooseMedia) wx.chooseMedia(options)
    else wx.chooseImage(options)
  },
  saveDishEditor() {
    const name = (this.data.editorName || '').trim()
    const category = this.data.editorCategory
    if (!name || !category) return wx.showToast({ title: '请填写菜名并选择分类', icon: 'none' })
    const payload = {
      name: name,
      category: category,
      description: (this.data.editorDescription || '').trim(),
      recipe: (this.data.editorRecipe || '').trim(),
      imageUrl: this.data.editorImageUrl || null,
      sort: Number(this.data.editorSort || 0)
    }
    const id = this.data.editorDishId
    const path = '/api/families/' + app.globalData.familyId + '/menu/dishes' + (id ? '/' + id : '')
    this.setData({ editorSaving: true })
    this.authRequest(path, { method: id ? 'PUT' : 'POST', data: payload })
      .then(() => { this.setData({ dishEditorVisible: false }); return this.loadMenu() })
      .then(() => wx.showToast({ title: id ? '菜品已更新' : '菜品已添加', icon: 'success' }))
      .catch(err => wx.showToast({ title: err.message, icon: 'none' }))
      .finally(() => this.setData({ editorSaving: false }))
  },
  deleteDishFromList(e) {
    if (!this.data.customMenu || !this.data.editMode) return
    const id = Number(e.currentTarget.dataset.id)
    const name = e.currentTarget.dataset.name || '这道菜'
    this.confirmDeleteDish(id, name)
  },
  deleteDishEditor() {
    if (!this.data.editorDishId) return
    this.confirmDeleteDish(this.data.editorDishId, this.data.editorName || '这道菜')
  },
  confirmDeleteDish(id, name) {
    if (!id || !app.globalData.familyId) return
    wx.showModal({
      title: '删除菜品',
      content: '确定删除「' + name + '」吗？',
      confirmText: '删除',
      confirmColor: '#b25f50',
      success: res => {
        if (!res.confirm) return
        this.authRequest('/api/families/' + app.globalData.familyId + '/menu/dishes/' + id, { method: 'DELETE' })
          .then(() => { this.setData({ dishEditorVisible: false }); return this.loadMenu() })
          .then(() => wx.showToast({ title: '菜品已删除', icon: 'success' }))
          .catch(err => wx.showToast({ title: err.message, icon: 'none' }))
      }
    })
  },
  input(e) {
    const field = e.currentTarget.dataset.field
    const data = { [field]: e.detail.value }
    if (field === 'joinCode' && this.data.joinPreview) data.joinPreview = null
    this.setData(data)
  },
  submitOrder() {
    if (!app.globalData.familyId) return wx.showToast({ title: '请先创建或加入家庭组', icon: 'none' })
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
    if (!name) return wx.showToast({ title: '请填写家庭组名称', icon: 'none' })
    this.authRequest('/api/families', { method: 'POST', data: { name: name } }).then(family => {
      app.globalData.familyId = family.id
      wx.setStorageSync('familyId', family.id)
      this.setData({ familyId: family.id, familyName: '', familyVisible: false })
      return this.loadFamilies()
    }).then(() => wx.showToast({ title: '家庭组已创建', icon: 'success' })).catch(err => wx.showToast({ title: err.message, icon: 'none' }))
  },
  createInviteCode() {
    if (!this.data.familyId) return wx.showToast({ title: '请先创建家庭组', icon: 'none' })
    const familyId = this.data.familyId
    this.authRequest('/api/families/' + familyId + '/invite-code', { method: 'POST' }).then(result => {
      this.inviteCodes = this.inviteCodes || {}
      this.inviteCodes[familyId] = result.inviteCode
      this.setData({ inviteCode: result.inviteCode })
      wx.setClipboardData({ data: result.inviteCode })
      wx.showToast({ title: '邀请码已复制', icon: 'success' })
    }).catch(err => wx.showToast({ title: err.message, icon: 'none' }))
  },
  previewJoinFamily() {
    const code = (this.data.joinCode || '').trim().toUpperCase()
    if (code.length !== 6) return wx.showToast({ title: '请输入 6 位邀请码', icon: 'none' })
    if (this.data.joinLooking) return
    this.setData({ joinLooking: true })
    this.authRequest('/api/family-invitations/preview?inviteCode=' + encodeURIComponent(code))
      .then(preview => this.setData({ joinPreview: preview, joinCode: code }))
      .catch(err => wx.showToast({ title: err.message, icon: 'none' }))
      .finally(() => this.setData({ joinLooking: false }))
  },
  clearJoinPreview() {
    this.setData({ joinPreview: null })
  },
  joinFamily() {
    const preview = this.data.joinPreview
    const code = ((preview && preview.inviteCode) || this.data.joinCode || '').trim()
    if (!preview || !preview.familyName) return this.previewJoinFamily()
    if (!code) return wx.showToast({ title: '请输入邀请码', icon: 'none' })
    this.authRequest('/api/family-invitations/join', { method: 'POST', data: { inviteCode: code } }).then(family => {
      app.globalData.familyId = family.id
      wx.setStorageSync('familyId', family.id)
      this.setData({ joinCode: '', joinPreview: null })
      return this.loadFamilies()
    }).then(() => wx.showToast({ title: '已加入家庭组', icon: 'success' })).catch(err => wx.showToast({ title: err.message, icon: 'none' }))
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
