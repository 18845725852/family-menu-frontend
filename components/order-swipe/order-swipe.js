Component({
  properties: {
    opened: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    deleting: { type: Boolean, value: false }
  },
  data: { nativeEnabled: false, offset: 0, dragging: false },
  observers: {
    opened(value) {
      if (value === this.lastOpened) return
      this.lastOpened = value
      if (this.swipeOffset) {
        this.swipeOffset.value = wx.worklet.timing(value ? -this.swipeWidth.value : 0, { duration: 180 })
      } else this.setData({ offset: value ? -144 : 0 })
    },
    disabled(value) {
      if (this.swipeDisabled) this.swipeDisabled.value = value
      if (value && this.gesture) this.onTouchCancel()
      if (value && this.swipeActive && this.swipeActive.value) {
        this.swipeActive.value = false
        this.swipeOffset.value = wx.worklet.timing(0, { duration: 180 })
        this.notifyEnd(false)
      }
    }
  },
  lifetimes: {
    attached() {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      this.unit = info.windowWidth / 750
      const worklet = wx.worklet
      if (!worklet || !['shared', 'timing', 'cancelAnimation', 'runOnJS'].every(key => typeof worklet[key] === 'function') || typeof this.applyAnimatedStyle !== 'function') return
      this.swipeOffset = worklet.shared(this.data.opened ? -144 * this.unit : 0)
      this.swipeWidth = worklet.shared(144 * this.unit)
      this.swipeDisabled = worklet.shared(this.data.disabled)
      this.swipeActive = worklet.shared(false)
    },
    ready() {
      if (!this.swipeOffset) return
      try {
        const offset = this.swipeOffset
        this.applyAnimatedStyle('#swipe-content', () => {
          'worklet'
          return { transform: 'translateX(' + offset.value + 'px)' }
        })
        this.setData({ nativeEnabled: true })
      } catch (error) {
        this.swipeOffset = null
      }
    },
    detached() {
      if (this.swipeOffset) wx.worklet.cancelAnimation(this.swipeOffset)
    }
  },
  pageLifetimes: {
    resize(info) {
      this.unit = info.size.windowWidth / 750
      if (this.swipeOffset) {
        this.swipeWidth.value = 144 * this.unit
        this.swipeOffset.value = this.data.opened ? -144 * this.unit : 0
      }
    }
  },
  methods: {
    onGesture(event) {
      'worklet'
      if (!this.swipeOffset || this.swipeDisabled.value) return
      // Skyline states: BEGAN=1, ACTIVE=2, END=3, CANCELLED=4.
      if (event.state === 1) {
        this.swipeActive.value = true
        wx.worklet.cancelAnimation(this.swipeOffset)
        wx.worklet.runOnJS(this.notifyStart)()
      } else if (event.state === 2) {
        if (!this.swipeActive.value) return
        this.swipeOffset.value = Math.max(-this.swipeWidth.value, Math.min(0, this.swipeOffset.value + event.deltaX))
      } else if (event.state === 3 || event.state === 4) {
        if (!this.swipeActive.value) return
        this.swipeActive.value = false
        const opened = event.state === 3 && this.swipeOffset.value <= -this.swipeWidth.value / 3
        this.swipeOffset.value = wx.worklet.timing(opened ? -this.swipeWidth.value : 0, { duration: 180 })
        wx.worklet.runOnJS(this.notifyEnd)(opened)
      }
    },
    notifyStart() { this.triggerEvent('dragstart') },
    notifyEnd(opened) {
      // The row already owns its settling animation; the parent's echoed property
      // must not restart it after a JS round-trip.
      this.lastOpened = opened
      this.triggerEvent('dragend', { opened: opened })
    },
    deleteOrder() { if (!this.data.disabled) this.triggerEvent('delete') },
    // Older renderers keep the same gesture rules, with updates local to this row.
    onTouchStart(event) {
      if (this.data.nativeEnabled || this.data.disabled || event.touches.length !== 1) return
      this.gesture = { x: event.touches[0].clientX, y: event.touches[0].clientY, offset: this.data.offset, horizontal: false }
    },
    onTouchMove(event) {
      const gesture = this.gesture
      if (this.data.nativeEnabled || !gesture) return
      if (event.touches.length !== 1) return this.onTouchCancel()
      const dx = event.touches[0].clientX - gesture.x
      const dy = event.touches[0].clientY - gesture.y
      if (!gesture.horizontal) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return
        if (Math.abs(dy) >= Math.abs(dx)) { this.gesture = null; return }
        gesture.horizontal = true
        this.notifyStart()
      }
      const offset = Math.max(-144, Math.min(0, gesture.offset + dx / this.unit))
      if (offset !== this.data.offset || !this.data.dragging) this.setData({ offset: offset, dragging: true })
    },
    onTouchEnd() {
      const gesture = this.gesture
      this.gesture = null
      if (!gesture || !gesture.horizontal) return
      const opened = this.data.offset <= -48
      this.setData({ offset: opened ? -144 : 0, dragging: false })
      this.notifyEnd(opened)
    },
    onTouchCancel() {
      if (this.data.nativeEnabled) return
      const dragging = this.gesture && this.gesture.horizontal
      this.gesture = null
      this.setData({ offset: 0, dragging: false })
      if (dragging) this.notifyEnd(false)
    }
  }
})
