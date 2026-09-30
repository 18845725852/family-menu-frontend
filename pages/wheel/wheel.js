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
        'content-type': 'application/json'
      }, app.globalData.sessionToken ? { Authorization: 'Bearer ' + app.globalData.sessionToken } : {}),
      success(res) {
        const body = res.data || {}
        if (res.statusCode >= 200 && res.statusCode < 300 && body.success !== false) resolve(body.data)
        else {
          const detail = body.data && body.data.message
          const error = new Error(body.message || detail || (res.statusCode === 401 ? '请先登录' : '请求失败'))
          error.statusCode = res.statusCode
          reject(error)
        }
      },
      fail(err) {
        reject(new Error(err && err.errMsg ? err.errMsg : '网络不可用，请确认后端服务已启动'))
      }
    })
  })
}


function pad(value) {
  return value < 10 ? '0' + value : '' + value
}

function formatSpinTime(value) {
  if (!value) return ''
  const text = String(value).replace('T', ' ')
  const match = text.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/)
  if (!match) return text.slice(0, 16)
  const now = new Date()
  const today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
  const day = match[1] + '-' + match[2] + '-' + match[3]
  if (day === today) return '今天 ' + match[4] + ':' + match[5]
  if (String(now.getFullYear()) === match[1]) return match[2] + '-' + match[3] + ' ' + match[4] + ':' + match[5]
  return day + ' ' + match[4] + ':' + match[5]
}

function resolveMediaUrl(value) {
  if (!value) return ''
  if (/^https?:\/\//.test(value)) return value
  return (app.globalData.apiBaseUrl || '') + (value.charAt(0) === '/' ? value : '/' + value)
}

const COLORS = ['#f5b971', '#f08a5d', '#f6bd60', '#8ecae6', '#90be6d', '#b8c0ff', '#ffcad4', '#a0c4ff', '#ffd166', '#95d5b2']

function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function splitLabel(name) {
  const text = String(name || '')
  if (text.length <= 4) return [text]
  const splitAt = Math.ceil(text.length / 2)
  return [text.slice(0, splitAt), text.slice(splitAt)]
}

function createWheelSvg(restaurants) {
  const size = 600
  const cx = 300
  const cy = 300
  const radius = 264
  const inner = 42
  const count = restaurants.length || 1
  const slice = (Math.PI * 2) / count
  const startOffset = -Math.PI / 2
  const segments = restaurants.length ? restaurants.map((item, index) => {
    const start = startOffset + index * slice
    const end = start + slice
    const x1 = cx + Math.cos(start) * radius
    const y1 = cy + Math.sin(start) * radius
    const x2 = cx + Math.cos(end) * radius
    const y2 = cy + Math.sin(end) * radius
    const largeArc = slice > Math.PI ? 1 : 0
    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`
    return `<path d="${path}" fill="${COLORS[index % COLORS.length]}"/>`
  }).join('') : ''

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${cx}" cy="${cy}" r="${radius}" fill="#ffffff"/>
      ${segments}
      <circle cx="${cx}" cy="${cy}" r="${inner + 20}" fill="rgba(255,255,255,0.88)"/>
      <circle cx="${cx}" cy="${cy}" r="${inner}" fill="#20302a"/>
    </svg>
  `)}`
}

Page({
  data: {
    restaurants: [],
    labels: [],
    wheelSvg: '',
    pointerRotation: -90,
    spinning: false,
    result: null,
    hasSpun: false,
    loading: true,
    error: '',
    loggedIn: false,
    hasFamily: false,
    customized: false,
    spins: [],
    recentSpins: [],
    allSpins: [],
    historyVisible: false,
    historyLoading: false,
    historyHeight: 420,
    defaultAvatarUrl: '/assets/default-avatar.jpg',
    editing: false,
    saving: false,
    draft: [],
    windowHeight: 700
  },

  onLoad() {
    const windowInfo = (wx.getWindowInfo && wx.getWindowInfo()) || wx.getSystemInfoSync() || {}
    const windowHeight = windowInfo.windowHeight || 700
    this.setData({ windowHeight: windowHeight, historyHeight: Math.round(windowHeight * 0.58) })
  },

  onShow() {
    if (this.data.editing || this.data.spinning) return
    this.loadWheel()
  },

  onReady() {
    this.bindPointerAnimation()
  },

  onUnload() {
    if (this.pointerRotation && wx.worklet && wx.worklet.cancelAnimation) {
      wx.worklet.cancelAnimation(this.pointerRotation)
    }
  },

  bindPointerAnimation() {
    if (!wx.worklet || typeof this.applyAnimatedStyle !== 'function') return
    const rotation = wx.worklet.shared(-90)
    this.applyAnimatedStyle('#wheel-pointer', () => {
      'worklet'
      return {
        transform: 'rotate(' + rotation.value + 'deg)'
      }
    })
    this.pointerRotation = rotation
  },

  onShareAppMessage() {
    return {
      title: '不想做饭？转盘帮你决定吃什么',
      path: '/pages/wheel/wheel',
      imageUrl: '/assets/share-cover.jpg'
    }
  },

  onShareTimeline() {
    return {
      title: '不想做饭？转盘帮你决定吃什么',
      query: '',
      imageUrl: '/assets/share-cover.jpg'
    }
  },

  isLoggedIn() {
    return !!(app.globalData.sessionToken && app.globalData.currentUser)
  },

  applyRestaurants(list) {
    list = list || []
    const count = list.length || 1
    const slice = 360 / count
    const frameSize = 560
    const border = 14
    const imageSize = frameSize - border * 2
    const svgSize = 600
    const svgOuter = 264
    const svgInner = 62
    const scale = imageSize / svgSize
    const outerR = border + svgOuter * scale
    const innerR = border + svgInner * scale
    const bandRatio = count > 12 ? 0.62 : count > 8 ? 0.58 : 0.55
    const textRadius = innerR + (outerR - innerR) * bandRatio
    const center = frameSize / 2
    const fontSize = count > 12 ? 16 : count > 8 ? 18 : 20
    const labels = list.map((item, index) => {
      const angle = (-90 + (index + 0.5) * slice) * Math.PI / 180
      return {
        id: item.id || ('draft-' + index),
        lines: splitLabel(item.name),
        left: center + Math.cos(angle) * textRadius,
        top: center + Math.sin(angle) * textRadius,
        fontSize: fontSize
      }
    })
    this.setData({
      restaurants: list,
      labels: labels,
      wheelSvg: createWheelSvg(list)
    })
  },

  decorateSpin(spin) {
    spin = spin || {}
    return {
      id: spin.id,
      nickname: spin.nickname || '家人',
      restaurantName: spin.restaurantName || '',
      avatarUrl: resolveMediaUrl(spin.avatarUrl),
      timeText: formatSpinTime(spin.createdAt)
    }
  },

  loadGlobalRestaurants() {
    return request('/api/restaurants').then(restaurants => {
      this.applyRestaurants(restaurants || [])
      this.setData({ hasFamily: false, customized: false, spins: [], recentSpins: [] })
    })
  },

  loadWheel() {
    const loggedIn = this.isLoggedIn()
    const familyId = loggedIn ? app.globalData.familyId : null
    const ticket = (this.loadTicket || 0) + 1
    this.loadTicket = ticket
    this.setData({ loading: true, error: '', loggedIn: loggedIn, editing: false })
    if (!loggedIn || !familyId) {
      return this.loadGlobalRestaurants().catch(err => {
        if (ticket !== this.loadTicket) return
        this.setData({ error: err.message })
      }).finally(() => {
        if (ticket === this.loadTicket) this.setData({ loading: false })
      })
    }
    return request('/api/families/' + familyId + '/wheel').then(data => {
      if (ticket !== this.loadTicket) return
      data = data || {}
      this.applyRestaurants(data.restaurants || [])
      const spins = (data.spins || []).map(item => this.decorateSpin(item))
      this.setData(Object.assign({
        hasFamily: true,
        customized: !!data.customized
      }, this.spinLists(spins)))
    }).catch(err => {
      if (ticket !== this.loadTicket) return
      if (err.statusCode === 401) {
        this.setData({ loggedIn: false, hasFamily: false, spins: [], recentSpins: [] })
        return this.loadGlobalRestaurants()
      }
      this.setData({ error: err.message, hasFamily: false, spins: [], recentSpins: [] })
    }).finally(() => {
      if (ticket === this.loadTicket) this.setData({ loading: false })
    })
  },

  startEdit() {
    if (!this.isLoggedIn()) {
      wx.showToast({ title: '请先到「我的」登录', icon: 'none' })
      return
    }
    if (!this.data.hasFamily || !app.globalData.familyId) {
      wx.showToast({ title: '请先创建或加入家庭组', icon: 'none' })
      return
    }
    const draft = (this.data.restaurants || []).map((item, index) => ({
      key: String(item.id || index),
      name: item.name
    }))
    this.setData({ editing: true, draft: draft })
  },

  cancelEdit() {
    this.setData({ editing: false, draft: [] })
  },

  inputDraft(e) {
    const index = Number(e.currentTarget.dataset.index)
    const draft = this.data.draft.slice()
    if (!draft[index]) return
    draft[index] = Object.assign({}, draft[index], { name: e.detail.value })
    this.setData({ draft: draft })
  },

  addDraft() {
    if (this.data.draft.length >= 16) {
      wx.showToast({ title: '最多添加 16 家餐厅', icon: 'none' })
      return
    }
    const draft = this.data.draft.concat([{ key: 'new-' + Date.now(), name: '' }])
    this.setData({ draft: draft })
  },

  removeDraft(e) {
    if (this.data.draft.length <= 3) {
      wx.showToast({ title: '至少保留 3 家餐厅', icon: 'none' })
      return
    }
    const index = Number(e.currentTarget.dataset.index)
    const draft = this.data.draft.filter((_, i) => i !== index)
    this.setData({ draft: draft })
  },

  saveDraft() {
    if (this.data.saving) return
    const names = []
    const seen = {}
    for (let i = 0; i < this.data.draft.length; i++) {
      const name = String(this.data.draft[i].name || '').trim()
      if (!name) {
        wx.showToast({ title: '餐厅名称不能为空', icon: 'none' })
        return
      }
      if (name.length > 20) {
        wx.showToast({ title: '名称不能超过20个字', icon: 'none' })
        return
      }
      if (seen[name]) {
        wx.showToast({ title: '餐厅名称不能重复', icon: 'none' })
        return
      }
      seen[name] = true
      names.push(name)
    }
    if (names.length < 3 || names.length > 16) {
      wx.showToast({ title: '餐厅数量需要 3 到 16 家', icon: 'none' })
      return
    }
    if (!app.globalData.familyId) {
      wx.showToast({ title: '请先创建或加入家庭组', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    request('/api/families/' + app.globalData.familyId + '/wheel/restaurants', {
      method: 'PUT',
      data: { items: names.map(name => ({ name: name })) }
    }).then(data => {
      data = data || {}
      this.applyRestaurants(data.restaurants || [])
      const spins = (data.spins || []).map(item => this.decorateSpin(item))
      this.setData(Object.assign({
        editing: false,
        draft: [],
        result: null,
        hasSpun: false,
        hasFamily: true,
        customized: true
      }, this.spinLists(spins)))
      wx.showToast({ title: '已保存，家里人都能看到', icon: 'success' })
    }).catch(err => {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    }).finally(() => {
      this.setData({ saving: false })
    })
  },

  goBack() {
    wx.navigateBack({ delta: 1 })
  },

  goLogin() {
    app.globalData.openFamilyTab = true
    app.globalData.openLogin = true
    wx.navigateBack({ delta: 1 })
  },

  goFamily() {
    app.globalData.openFamilyTab = true
    wx.navigateBack({ delta: 1 })
  },

  spinLists(list) {
    const spins = list || []
    return {
      spins: spins,
      recentSpins: spins.slice(0, 5)
    }
  },

  openHistory() {
    if (!this.data.spins.length) return
    this.setData({
      historyVisible: true,
      historyLoading: true,
      allSpins: this.data.spins
    })
    if (!app.globalData.familyId) {
      this.setData({ historyLoading: false })
      return
    }
    request('/api/families/' + app.globalData.familyId + '/wheel/spins').then(list => {
      if (!this.data.historyVisible) return
      this.setData({
        allSpins: (list || []).map(item => this.decorateSpin(item)),
        historyLoading: false
      })
    }).catch(err => {
      if (!this.data.historyVisible) return
      this.setData({ historyLoading: false })
      if (err.statusCode === 404) return
      wx.showToast({ title: err.message || '全部记录加载失败', icon: 'none' })
    })
  },

  closeHistory() {
    this.setData({ historyVisible: false })
  },

  noop() {},

  recordSpin(result) {
    if (!this.data.hasFamily || !app.globalData.familyId || !result) return
    this.loadTicket = (this.loadTicket || 0) + 1
    request('/api/families/' + app.globalData.familyId + '/wheel/spins', {
      method: 'POST',
      data: { name: result.name }
    }).then(spin => {
      const item = this.decorateSpin(spin)
      const spins = [item].concat(this.data.spins || []).filter((row, index, list) => {
        return list.findIndex(candidate => candidate.id === row.id) === index
      })
      const patch = this.spinLists(spins)
      if (this.data.historyVisible) {
        patch.allSpins = [item].concat(this.data.allSpins || []).filter((row, index, list) => {
          return list.findIndex(candidate => candidate.id === row.id) === index
        })
      }
      this.setData(patch)
    }).catch(err => {
      wx.showToast({ title: err.message || '结果没记上', icon: 'none' })
    })
  },

  spinWheel() {
    if (this.data.spinning) return
    if (!this.data.restaurants.length) {
      wx.showToast({ title: '还没有可抽的餐厅', icon: 'none' })
      return
    }
    const chosenIndex = Math.floor(Math.random() * this.data.restaurants.length)
    const slice = 360 / this.data.restaurants.length
    const desired = -90 + chosenIndex * slice + slice / 2
    const current = this.pointerRotation ? this.pointerRotation.value : this.data.pointerRotation
    const currentAngle = ((current % 360) + 360) % 360
    const desiredAngle = ((desired % 360) + 360) % 360
    const delta = (desiredAngle - currentAngle + 360) % 360
    const turns = 11 + Math.floor(Math.random() * 3)
    const nextRotation = current + turns * 360 + delta
    const result = this.data.restaurants[chosenIndex]
    const duration = 10000
    this.pendingResult = result
    if (this.pointerRotation && wx.worklet && wx.worklet.timing) {
      const { timing, Easing, cancelAnimation, runOnJS } = wx.worklet
      const onDone = (finished) => {
        if (!finished) return
        const landed = this.pendingResult
        this.setData({ spinning: false, result: landed, hasSpun: true })
        this.recordSpin(landed)
      }
      cancelAnimation(this.pointerRotation)
      const easing = Easing.bezier ? Easing.bezier(0.22, 0.61, 0.36, 1) : Easing.out(Easing.cubic)
      this.pointerRotation.value = timing(nextRotation, {
        duration: duration,
        easing: easing
      }, (finished) => {
        'worklet'
        runOnJS(onDone)(finished)
      })
    } else {
      this.setData({ pointerRotation: nextRotation })
      setTimeout(() => {
        this.setData({ spinning: false, result: result, hasSpun: true })
        this.recordSpin(result)
      }, duration + 200)
    }
    this.setData({
      spinning: true,
      // Keep the previous result card in place for subsequent spins.
      result: this.data.hasSpun ? this.data.result : null
    })
  }
})
