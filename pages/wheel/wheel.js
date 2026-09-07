const app = getApp()

function request(path, options) {
  options = options || {}
  return new Promise((resolve, reject) => {
    wx.request({
      url: (app.globalData.apiBaseUrl || '') + path,
      method: options.method || 'GET',
      data: options.data,
      header: Object.assign({
        'content-type': 'application/json'
      }, app.globalData.sessionToken ? { Authorization: 'Bearer ' + app.globalData.sessionToken } : {}),
      success(res) {
        const body = res.data || {}
        if (res.statusCode >= 200 && res.statusCode < 300 && body.success !== false) resolve(body.data)
        else reject(new Error(body.message || '请求失败'))
      },
      fail() {
        reject(new Error('网络不可用，请确认后端服务已启动'))
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
    error: ''
  },

  onLoad() {
    this.loadRestaurants()
  },

  loadRestaurants() {
    this.setData({ loading: true, error: '' })
    return request('/api/restaurants').then(restaurants => {
      const list = restaurants || []
      const count = list.length || 1
      const slice = 360 / count
      // Keep labels in the same fixed coordinate system as the 560rpx wheel.
      const wheelSize = 560
      const textRadius = count > 8 ? 158 : 166
      const center = wheelSize / 2
      const labels = list.map((item, index) => {
        const angle = -90 + index * slice + slice / 2
        const rad = angle * Math.PI / 180
        const x = center + Math.cos(rad) * textRadius
        const y = center + Math.sin(rad) * textRadius
        return {
          id: item.id,
          lines: splitLabel(item.name),
          left: x,
          top: y,
          width: count > 8 ? 104 : 116,
          fontSize: count > 8 ? 17 : 19
        }
      })
      this.setData({
        restaurants: list,
        labels: labels,
        wheelSvg: createWheelSvg(list)
      })
    }).catch(err => {
      this.setData({ error: err.message })
    }).finally(() => {
      this.setData({ loading: false })
    })
  },

  goBack() {
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
    const current = this.data.pointerRotation
    const currentAngle = ((current % 360) + 360) % 360
    const desiredAngle = ((desired % 360) + 360) % 360
    const delta = (desiredAngle - currentAngle + 360) % 360
    const turns = 4 + Math.floor(Math.random() * 3)
    const nextRotation = current + turns * 360 + delta
    const result = this.data.restaurants[chosenIndex]
    this.setData({
      spinning: true,
      // Keep the previous result card in place for subsequent spins.
      result: this.data.hasSpun ? this.data.result : null,
      pointerRotation: nextRotation
    })
    setTimeout(() => {
      this.setData({ spinning: false, result: result, hasSpun: true })
    }, 4500)
  }
})
