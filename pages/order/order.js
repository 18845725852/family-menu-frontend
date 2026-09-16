const app = getApp()

function request(path, options) {
  options = options || {}
  return new Promise((resolve, reject) => wx.request({
    url: (app.globalData.apiBaseUrl || '') + path,
    method: options.method || 'GET',
    data: options.data,
    timeout: 15000,
    enableHttp2: false,
    enableQuic: false,
    header: Object.assign({ 'content-type': 'application/json' }, app.globalData.sessionToken ? { Authorization: 'Bearer ' + app.globalData.sessionToken } : {}),
    success(res) {
      const body = res.data || {}
      if (res.statusCode >= 200 && res.statusCode < 300 && body.success !== false) resolve(body.data)
      else reject(new Error(body.message || '请求失败'))
    },
    fail: err => reject(new Error(err && err.errMsg ? err.errMsg : '网络不可用，请确认后端服务已启动'))
  }))
}

Page({
  data: { basket: [], basketCount: 0, operatorName: '微信用户', operatorInitial: '微', remark: '', submitting: false },
  onLoad() {
    if (!app.globalData.familyId) {
      wx.showModal({
        title: '暂时不能下单',
        content: '请先创建或加入家庭，之后才能提交和查看家庭订单。',
        showCancel: false,
        success: () => wx.navigateBack({ delta: 1 })
      })
      return
    }
    const basket = app.globalData.pendingBasket || []
    const user = app.globalData.currentUser || {}
    const operatorName = user.nickname || '微信用户'
    this.setData({ basket, basketCount: basket.reduce((sum, item) => sum + item.quantity, 0), operatorName, operatorInitial: operatorName.substring(0, 1) })
  },
  onShareAppMessage() {
    return {
      title: '一起看看今晚吃什么',
      path: '/pages/index/index'
    }
  },
  onShareTimeline() {
    return {
      title: '一起看看今晚吃什么',
      query: ''
    }
  },
  inputRemark(e) { this.setData({ remark: e.detail.value }) },
  changeQuantity(e) {
    const id = Number(e.currentTarget.dataset.id)
    const delta = Number(e.currentTarget.dataset.delta)
    const basket = this.data.basket.map(item => Object.assign({}, item))
    const item = basket.find(row => Number(row.dishId) === id)
    if (!item) return
    item.quantity += delta
    const next = basket.filter(row => row.quantity > 0)
    app.globalData.pendingBasket = next
    this.setData({ basket: next, basketCount: next.reduce((sum, row) => sum + row.quantity, 0) })
  },
  goBack() {
    wx.navigateBack({ delta: 1 })
  },
  submitOrder() {
    if (!this.data.basket.length) return wx.showToast({ title: '还没有选择菜品', icon: 'none' })
    if (!app.globalData.familyId) return wx.showToast({ title: '请先创建或加入家庭', icon: 'none' })
    this.setData({ submitting: true })
    request('/api/families/' + app.globalData.familyId + '/orders', { method: 'POST', data: { items: this.data.basket, remark: this.data.remark } })
      .then(() => {
        app.globalData.pendingBasket = []
        app.globalData.orderEditing = false
        app.globalData.orderSubmitted = true
        wx.showToast({ title: '订单已提交', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 500)
      })
      .catch(err => wx.showToast({ title: err.message, icon: 'none' }))
      .finally(() => this.setData({ submitting: false }))
  }
})
