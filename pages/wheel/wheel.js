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
          const error = new Error(body.message || (res.statusCode === 401 ? '请先登录' : '请求失败'))
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
    editing: false,
    saving: false,
    draft: [],
    windowHeight: 700
  },

  onLoad() {
    const windowInfo = (wx.getWindowInfo && wx.getWindowInfo()) || wx.getSystemInfoSync() || {}
    this.setData({ windowHeight: windowInfo.windowHeight || 700 })
    this.loadRestaurants()
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
      path: '/pages/wheel/wheel'
    }
  },

  onShareTimeline() {
    return {
      title: '不想做饭？转盘帮你决定吃什么',
      query: ''
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

  loadRestaurants() {
    const loggedIn = this.isLoggedIn()
    this.setData({ loading: true, error: '', loggedIn: loggedIn, editing: false })
    const loadGlobal = () => request('/api/restaurants').then(restaurants => {
      this.applyRestaurants(restaurants || [])
    })
    if (!loggedIn) {
      return loadGlobal().catch(err => {
        this.setData({ error: err.message })
      }).finally(() => {
        this.setData({ loading: false })
      })
    }
    return request('/api/me/wheel-restaurants').then(restaurants => {
      const list = restaurants || []
      if (list.length) {
        this.applyRestaurants(list)
        return
      }
      return loadGlobal()
    }).catch(err => {
      if (err.statusCode === 401) {
        this.setData({ loggedIn: false })
        return loadGlobal()
      }
      this.setData({ error: err.message })
    }).finally(() => {
      this.setData({ loading: false })
    })
  },

  startEdit() {
    if (!this.isLoggedIn()) {
      wx.showToast({ title: '请先到「我的」登录', icon: 'none' })
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
    this.setData({ saving: true })
    request('/api/me/wheel-restaurants', {
      method: 'PUT',
      data: { items: names.map(name => ({ name: name })) }
    }).then(restaurants => {
      this.applyRestaurants(restaurants || [])
      this.setData({ editing: false, draft: [], result: null, hasSpun: false })
      wx.showToast({ title: '已保存到我的转盘', icon: 'success' })
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
        this.setData({ spinning: false, result: this.pendingResult, hasSpun: true })
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
      }, duration + 200)
    }
    this.setData({
      spinning: true,
      // Keep the previous result card in place for subsequent spins.
      result: this.data.hasSpun ? this.data.result : null
    })
  }
})
