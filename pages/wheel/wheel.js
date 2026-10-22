// 保留旧分享链接，统一进入首页的转盘页签。
Page({
  onLoad() {
    wx.redirectTo({ url: '/pages/index/index?tab=wheel' })
  }
})
