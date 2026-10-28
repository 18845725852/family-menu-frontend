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

// 2D card motion also works in Skyline: squeeze the card before revealing its face.
const REST_MOTION = { x: 0, y: 0, angle: 0, scale: 1, packX: 0, packY: 0, packAngle: 0, deckY: 0, deckScale: 1 }
const DRAW_FRAMES = [
  { phase: 'preparing', duration: 40 },
  { phase: 'shuffling', x: -18, angle: -2, packX: -28, packY: -8, packAngle: -5, duration: 210 },
  { phase: 'shuffling', x: 22, angle: 2, packX: 30, packY: -16, packAngle: 5, duration: 230 },
  { phase: 'shuffling', x: -16, angle: -2, packX: -24, packY: -6, packAngle: -4, duration: 210 },
  { phase: 'shuffling', x: 12, angle: 1, packX: 20, packY: -12, packAngle: 3, duration: 230 },
  { phase: 'gathering', duration: 180 },
  { phase: 'drawing', x: 14, y: -154, angle: 2, deckY: 250, deckScale: 0.6, duration: 520 },
  { phase: 'holding', x: 14, y: -154, angle: 2, deckY: 250, deckScale: 0.6, duration: 180 },
  { phase: 'flipping', x: 14, y: -154, scale: 0.02, deckY: 250, deckScale: 0.6, duration: 220 },
  { phase: 'revealing', y: -120, deckY: 250, deckScale: 0.6, duration: 300, front: true },
  { phase: 'settling', duration: 420, front: true }
]

function sampleCardMotion(progress, frames) {
  'worklet'
  const position = Math.max(0, Math.min(progress, frames.length - 1))
  const index = Math.floor(position)
  const from = frames[index]
  const to = frames[Math.min(index + 1, frames.length - 1)]
  const t = position - index
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    angle: from.angle + (to.angle - from.angle) * t,
    scale: from.scale + (to.scale - from.scale) * t,
    packX: from.packX + (to.packX - from.packX) * t,
    packY: from.packY + (to.packY - from.packY) * t,
    packAngle: from.packAngle + (to.packAngle - from.packAngle) * t,
    deckY: from.deckY + (to.deckY - from.deckY) * t,
    deckScale: from.deckScale + (to.deckScale - from.deckScale) * t
  }
}

Component({
  properties: {
    active: { type: Boolean, value: false },
    familyId: { type: null, value: null },
    authenticated: { type: Boolean, value: false }
  },
  observers: {
    'hasFamily, loggedIn, error'() {
      if (this.wheelReady) this.fitDrawScreen()
    },
    'active, familyId, authenticated'() {
      if (this.wheelReady) {
        this.syncContext()
        if (this.data.active) this.fitDrawScreen()
      }
    }
  },
  lifetimes: {
    attached() {
      const info = (wx.getWindowInfo && wx.getWindowInfo()) || wx.getSystemInfoSync() || {}
      this.setData({ historyHeight: Math.round((info.windowHeight || 700) * 0.58) })
      this.wheelReady = true
      this.syncContext()
    },
    ready() { this.bindCardAnimation(); this.fitDrawScreen() },
    detached() {
      this.wheelReady = false
      this.loadTicket = (this.loadTicket || 0) + 1
      this.stopAnimation()
    }
  },
  pageLifetimes: {
    show() { if (this.wheelReady && this.data.active) this.syncContext() },
    resize(info) {
      if (info.size.windowWidth && this.cardUnit) this.cardUnit.value = info.size.windowWidth / 750
      this.setData({ historyHeight: Math.round(info.size.windowHeight * 0.58) })
      this.fitDrawScreen()
    }
  },
  data: {
    drawScreenHeight: 460,
    cardScale: 0.55,
    restaurants: [],
    cardTransform: 'translate(0rpx, 0rpx) rotate(0deg) scaleX(1)',
    packTransform: 'translate(0rpx, 0rpx) rotate(0deg)',
    deckTransform: 'translateY(0rpx) scale(1)',
    cardDuration: 0,
    cardFaceFront: false,
    cardRestaurantName: '',
    drawPhase: 'idle',
    workletEnabled: false,
    spinning: false,
    recording: false,
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
    draft: []
  },

  methods: {
    fitDrawScreen() {
      if (!this.wheelReady || this.data.spinning || this.data.recording || typeof this.createSelectorQuery !== 'function') return
      const ticket = (this.layoutTicket || 0) + 1
      this.layoutTicket = ticket
      const isCurrent = () => this.wheelReady && ticket === this.layoutTicket && !this.data.spinning && !this.data.recording
      const nextTick = wx.nextTick || (callback => callback())
      nextTick(() => {
        if (!isCurrent()) return
        this.createSelectorQuery().select('.page-scroll').boundingClientRect(rect => {
          if (!isCurrent() || !rect || rect.height <= 0) return
          const info = (wx.getWindowInfo && wx.getWindowInfo()) || {}
          const ratio = (info.windowWidth || 375) / 750
          const signature = [Math.floor(rect.height), rect.width || info.windowWidth || 375, this.data.hasFamily, this.data.loggedIn, this.data.error].join(':')
          // Content/record updates at an unchanged viewport must not shrink a revealed card.
          if (signature === this.cardLayoutSignature) return
          // This viewport already excludes the home heading, navigation and safe area.
          this.setData({ drawScreenHeight: Math.floor(rect.height) }, () => {
            nextTick(() => {
              if (!isCurrent()) return
              this.createSelectorQuery().select('.card-stage').boundingClientRect(stage => {
                if (!isCurrent() || !stage || stage.height <= 0 || stage.width <= 0) return
                const scale = Math.min(1, stage.height / (800 * ratio), stage.width / (694 * ratio))
                this.cardLayoutSignature = signature
                // Round down so the deck never overlaps the fixed-size caption and controls.
                this.setData({ cardScale: Math.floor(scale * 1000) / 1000 })
              }).exec()
            })
          })
        }).exec()
      })
    },

    syncContext() {
      const context = (app.globalData.sessionToken || '') + ':' + (app.globalData.familyId || '')
      if (this.wheelContext !== context) {
        this.wheelContext = context
        this.loadTicket = (this.loadTicket || 0) + 1
        this.stopAnimation()
        this.setData({ editing: false, saving: false, recording: false, loading: false, error: '', draft: [], spinning: false, cardFaceFront: false, cardRestaurantName: '', drawPhase: 'idle', cardTransform: 'translate(0rpx, 0rpx) rotate(0deg) scaleX(1)', packTransform: 'translate(0rpx, 0rpx) rotate(0deg)', deckTransform: 'translateY(0rpx) scale(1)', cardDuration: 0, result: null, hasSpun: false, historyVisible: false, historyLoading: false, allSpins: [], restaurants: [], spins: [], recentSpins: [], hasFamily: false })
        this.resetCardMotion()
      }
      if (this.data.active && !this.data.editing && !this.data.spinning) this.loadWheel()
    },

    stopAnimation() {
      this.spinToken = (this.spinToken || 0) + 1
      this.drawFrameIndex = null
      if (this.spinTimer) clearTimeout(this.spinTimer)
      this.spinTimer = null
      this.pendingResult = null
      if (this.cardMotion && wx.worklet && wx.worklet.cancelAnimation) {
        Object.keys(this.cardMotion).forEach(key => wx.worklet.cancelAnimation(this.cardMotion[key]))
      }
    },

    resetCardMotion() {
      if (!this.cardMotion) return
      this.cardMotion.progress.value = 0
    },

    bindCardAnimation() {
      const worklet = wx.worklet
      if (!worklet || typeof this.applyAnimatedStyle !== 'function' ||
          !['shared', 'timing', 'cancelAnimation'].every(key => typeof worklet[key] === 'function') || !worklet.Easing) return
      try {
        const progress = worklet.shared(0)
        const frames = [REST_MOTION].concat(DRAW_FRAMES.map(frame => Object.assign({}, REST_MOTION, frame)))
        const info = (wx.getWindowInfo && wx.getWindowInfo()) || {}
        const unit = worklet.shared((info.windowWidth || 375) / 750)
        this.applyAnimatedStyle('#draw-card', () => {
          'worklet'
          const motion = sampleCardMotion(progress.value, frames)
          return { transform: 'translate(' + motion.x * unit.value + 'px, ' + motion.y * unit.value + 'px) rotate(' + motion.angle + 'deg) scaleX(' + motion.scale + ')' }
        })
        this.applyAnimatedStyle('#card-pack', () => {
          'worklet'
          const motion = sampleCardMotion(progress.value, frames)
          return { transform: 'translate(' + motion.packX * unit.value + 'px, ' + motion.packY * unit.value + 'px) rotate(' + motion.packAngle + 'deg)' }
        })
        this.applyAnimatedStyle('#card-deck', () => {
          'worklet'
          const motion = sampleCardMotion(progress.value, frames)
          return { transform: 'translateY(' + motion.deckY * unit.value + 'px) scale(' + motion.deckScale + ')' }
        })
        // Both faces stay mounted, including the illustration. Switch on the UI clock
        // while edge-on, before expanding, without waiting for a setData round-trip.
        const revealProgress = DRAW_FRAMES.findIndex(frame => frame.front)
        this.applyAnimatedStyle('#card-back-face', () => {
          'worklet'
          return { opacity: progress.value < revealProgress ? 1 : 0 }
        })
        this.applyAnimatedStyle('#card-front-face', () => {
          'worklet'
          return { opacity: progress.value >= revealProgress ? 1 : 0 }
        })
        this.cardMotion = { progress: progress }
        this.cardUnit = unit
        this.setData({ workletEnabled: true })
      } catch (err) {
        this.cardMotion = null
        this.setData({ workletEnabled: false })
      }
    },

    animateCard(frame, onDone) {
      frame = Object.assign({}, REST_MOTION, frame)
      this.setData({
        drawPhase: frame.phase,
        cardDuration: frame.duration,
        packTransform: 'translate(' + frame.packX + 'rpx, ' + frame.packY + 'rpx) rotate(' + frame.packAngle + 'deg)',
        deckTransform: 'translateY(' + frame.deckY + 'rpx) scale(' + frame.deckScale + ')',
        cardTransform: 'translate(' + frame.x + 'rpx, ' + frame.y + 'rpx) rotate(' + frame.angle + 'deg) scaleX(' + frame.scale + ')'
      })
      if (!this.cardMotion || !wx.worklet) return
      const { timing, Easing, runOnJS } = wx.worklet
      const easing = typeof Easing.cubicBezier === 'function' ? Easing.cubicBezier(0.4, 0, 0.2, 1) : Easing.out(Easing.cubic)
      const completion = onDone && typeof runOnJS === 'function' ? (finished) => {
        'worklet'
        if (finished) runOnJS(onDone)()
      } : undefined
      // All three cards read this one clock, so no individual transform can land late.
      this.cardMotion.progress.value = timing(this.drawFrameIndex + 1, { duration: frame.duration, easing: easing }, completion)
    },

    isLoggedIn() {
      return !!(app.globalData.sessionToken && app.globalData.currentUser)
    },

    applyRestaurants(list) {
      this.setData({ restaurants: list || [] })
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

    loadGlobalRestaurants(ticket) {
      return request('/api/restaurants').then(restaurants => {
        if (ticket !== this.loadTicket) return
        this.applyRestaurants(restaurants || [])
        this.setData({ hasFamily: false, customized: false, spins: [], recentSpins: [] })
      })
    },

    loadWheel() {
      if (this.data.editing || this.data.saving || this.data.spinning || this.data.recording) return Promise.resolve()
      const loggedIn = this.isLoggedIn()
      const familyId = loggedIn ? app.globalData.familyId : null
      const ticket = (this.loadTicket || 0) + 1
      this.loadTicket = ticket
      this.setData({ loading: true, error: '', loggedIn: loggedIn, editing: false })
      if (!loggedIn || !familyId) {
        return this.loadGlobalRestaurants(ticket).catch(err => {
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
          return this.loadGlobalRestaurants(ticket)
        }
        this.setData({ error: err.message, hasFamily: false, spins: [], recentSpins: [] })
      }).finally(() => {
        if (ticket === this.loadTicket) this.setData({ loading: false })
      })
    },

    startEdit() {
      if (this.data.loading || this.data.error || this.data.spinning || this.data.recording || this.data.saving || this.data.editing) return
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
      if (this.data.saving) return
      this.setData({ editing: false, draft: [] })
    },

    inputDraft(e) {
      if (!this.data.editing || this.data.saving) return
      const index = Number(e.currentTarget.dataset.index)
      const draft = this.data.draft.slice()
      if (!draft[index]) return
      draft[index] = Object.assign({}, draft[index], { name: e.detail.value })
      this.setData({ draft: draft })
    },

    addDraft() {
      if (!this.data.editing || this.data.saving) return
      if (this.data.draft.length >= 16) {
        wx.showToast({ title: '最多添加 16 家餐厅', icon: 'none' })
        return
      }
      const draft = this.data.draft.concat([{ key: 'new-' + Date.now(), name: '' }])
      this.setData({ draft: draft })
    },

    removeDraft(e) {
      if (!this.data.editing || this.data.saving) return
      if (this.data.draft.length <= 3) {
        wx.showToast({ title: '至少保留 3 家餐厅', icon: 'none' })
        return
      }
      const index = Number(e.currentTarget.dataset.index)
      const draft = this.data.draft.filter((_, i) => i !== index)
      this.setData({ draft: draft })
    },

    saveDraft() {
      if (!this.data.editing || this.data.loading || this.data.spinning || this.data.recording || this.data.saving) return
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
      const context = this.wheelContext
      request('/api/families/' + app.globalData.familyId + '/wheel/restaurants', {
        method: 'PUT',
        data: { items: names.map(name => ({ name: name })) }
      }).then(data => {
        if (context !== this.wheelContext || !this.wheelReady) return
        data = data || {}
        this.applyRestaurants(data.restaurants || [])
        const spins = (data.spins || []).map(item => this.decorateSpin(item))
        this.setData(Object.assign({
          editing: false,
          draft: [],
          result: null,
          hasSpun: false,
          cardFaceFront: false,
          cardRestaurantName: '',
          drawPhase: 'idle',
          hasFamily: true,
          customized: true
        }, this.spinLists(spins)))
        this.resetCardMotion()
        wx.showToast({ title: '已保存，家里人都能看到', icon: 'success' })
      }).catch(err => {
        if (context !== this.wheelContext || !this.wheelReady) return
        wx.showToast({ title: err.message || '保存失败', icon: 'none' })
      }).finally(() => {
        if (context !== this.wheelContext || !this.wheelReady) return
        this.setData({ saving: false })
      })
    },

    goBack() { this.triggerEvent('navigate', { tab: 'menu' }) },

    goLogin() { this.triggerEvent('navigate', { tab: 'family', login: true }) },

    goFamily() { this.triggerEvent('navigate', { tab: 'family' }) },

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
      const context = this.wheelContext
      request('/api/families/' + app.globalData.familyId + '/wheel/spins').then(list => {
        if (context !== this.wheelContext || !this.data.historyVisible || !this.wheelReady) return
        this.setData({
          allSpins: (list || []).map(item => this.decorateSpin(item)),
          historyLoading: false
        })
      }).catch(err => {
        if (context !== this.wheelContext || !this.data.historyVisible || !this.wheelReady) return
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
      this.setData({ recording: true })
      const context = this.wheelContext
      request('/api/families/' + app.globalData.familyId + '/wheel/spins', {
        method: 'POST',
        data: { name: result.name }
      }).then(spin => {
        if (context !== this.wheelContext || !this.wheelReady) return
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
        if (context !== this.wheelContext || !this.wheelReady) return
        wx.showToast({ title: err.message || '结果没记上', icon: 'none' })
      }).finally(() => {
        if (context !== this.wheelContext || !this.wheelReady) return
        this.setData({ recording: false })
      })
    },

    spinWheel() {
      if (this.data.loading || this.data.error || this.data.editing || this.data.saving || this.data.spinning || this.data.recording) return
      if (!this.data.restaurants.length) {
        wx.showToast({ title: '还没有可抽的餐厅', icon: 'none' })
        return
      }
      // Invalidate measurements queued before the draw, including callbacks arriving after it.
      this.layoutTicket = (this.layoutTicket || 0) + 1
      this.stopAnimation()
      this.resetCardMotion()
      const token = this.spinToken
      this.pendingResult = this.data.restaurants[Math.floor(Math.random() * this.data.restaurants.length)]
      this.setData({ spinning: true, cardFaceFront: false, cardRestaurantName: this.pendingResult.name, cardDuration: 0, drawPhase: 'preparing', packTransform: 'translate(0rpx, 0rpx) rotate(0deg)', deckTransform: 'translateY(0rpx) scale(1)', cardTransform: 'translate(0rpx, 0rpx) rotate(0deg) scaleX(1)' })
      this.runDrawFrame(0, token)
    },

    runDrawFrame(index, token) {
      if (token !== this.spinToken || !this.data.spinning) return
      if (index >= DRAW_FRAMES.length) {
        return this.finishDraw(token)
      }
      const frame = DRAW_FRAMES[index]
      this.drawFrameIndex = index
      const advance = () => {
        if (token !== this.spinToken || this.drawFrameIndex !== index || !this.data.spinning) return
        if (this.spinTimer) clearTimeout(this.spinTimer)
        this.spinTimer = null
        this.runDrawFrame(index + 1, token)
      }
      const nativeCompletion = this.cardMotion && wx.worklet && typeof wx.worklet.runOnJS === 'function'
      // Swap content only while the card is edge-on; keep it hidden during shuffling.
      if (frame.front) this.setData({ cardFaceFront: true, result: this.pendingResult })
      // The extra delay is a watchdog for a missing native callback, not the normal clock.
      this.spinTimer = setTimeout(advance, frame.duration + (nativeCompletion ? 300 : 0))
      this.animateCard(frame, nativeCompletion ? advance : null)
    },

    finishDraw(token) {
      if (token !== this.spinToken || !this.data.spinning) return
      const result = this.pendingResult
      // Commit the same resting pose on both renderers before enabling another draw.
      this.stopAnimation()
      if (this.cardMotion) this.cardMotion.progress.value = DRAW_FRAMES.length
      this.setData({
        spinning: false, result: result, hasSpun: true, cardFaceFront: true, drawPhase: 'idle',
        cardDuration: 0,
        cardTransform: 'translate(0rpx, 0rpx) rotate(0deg) scaleX(1)',
        packTransform: 'translate(0rpx, 0rpx) rotate(0deg)',
        deckTransform: 'translateY(0rpx) scale(1)'
      })
      this.recordSpin(result)
    }
  }
})
