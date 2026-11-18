// pages/index/index.ts
import { CalcResult, ExtraInput, PersonRow, calculateFeeLabels, runCalculation } from '../../utils/calculator'

/* ========== 账单图片绘制（离屏 canvas） ========== */
const BILL_W = 750
const BILL_PAD = 36
const CHIP_COLORS: { [key: string]: { bg: string; fg: string } } = {
  s0: { bg: '#f0ebff', fg: '#7c5ce7' }, s1: { bg: '#e8f0ff', fg: '#4a7cf7' },
  s2: { bg: '#e2f7f3', fg: '#12a89a' }, s3: { bg: '#fff3df', fg: '#b97915' },
  s4: { bg: '#fdeaf3', fg: '#d45b8c' }, s5: { bg: '#e7f8ee', fg: '#2a9654' },
  extra: { bg: '#fff0f6', fg: '#e879a8' }
}

function billRoundRect(ctx: any, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function billWrap(ctx: any, text: string, maxW: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const ch of text) {
    if (cur && ctx.measureText(cur + ch).width > maxW) { lines.push(cur); cur = ch }
    else cur += ch
  }
  if (cur) lines.push(cur)
  return lines
}

// 每人卡片最多显示 4 条明细，避免图片过长
function billChipCount(p: PersonRow): number { return Math.min(p.chips.length, 4) }
function billCardHeight(p: PersonRow): number { return 132 + billChipCount(p) * 36 }

function billImageHeight(result: CalcResult): number {
  let y = 470 // header(210) + summary 起点/高度 + 分区标题后的位置
  result.personRows.forEach(p => { y += billCardHeight(p) + 16 })
  y += 8 + 90 + 18 + 30 + 30 // 说明预留 3 行 + 页脚 + 底部留白
  return Math.ceil(y)
}

function paintBill(ctx: any, result: CalcResult, height: number) {
  const W = BILL_W
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'

  // 背景
  ctx.fillStyle = '#faf9ff'
  ctx.fillRect(0, 0, W, height)

  // 顶部渐变
  const g = ctx.createLinearGradient(0, 0, W, 210)
  g.addColorStop(0, '#7c5ce7')
  g.addColorStop(1, '#e879a8')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, 210)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 42px sans-serif'
  ctx.fillText('羽毛球 AA · 收款账单', BILL_PAD, 52)
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.font = '24px sans-serif'
  ctx.fillText('费用 · 明细 · 每人应收，一目了然', BILL_PAD, 116)
  const d = new Date()
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  ctx.fillText(dateStr, BILL_PAD, 158)

  // 汇总卡
  const sy = 234
  ctx.fillStyle = '#ffffff'
  billRoundRect(ctx, BILL_PAD, sy, W - BILL_PAD * 2, 150, 28)
  ctx.fill()
  const metrics = [
    { label: '费用总计', val: result.total, color: '#7c5ce7' },
    { label: '参与人次', val: result.peopleText, color: '#4a7cf7' },
    { label: '收款人数', val: result.payersText, color: '#12a89a' }
  ]
  const colW = (W - BILL_PAD * 2) / 3
  metrics.forEach((m, i) => {
    const cx = BILL_PAD + colW * i + colW / 2
    ctx.textAlign = 'center'
    ctx.fillStyle = '#8b86a8'; ctx.font = '22px sans-serif'
    ctx.fillText(m.label, cx, sy + 24)
    ctx.fillStyle = m.color; ctx.font = 'bold 42px sans-serif'
    ctx.fillText(m.val, cx, sy + 64)
  })
  ctx.textAlign = 'left'

  // 分区标题
  let y = sy + 150 + 34
  ctx.fillStyle = '#2b2545'; ctx.font = 'bold 30px sans-serif'
  ctx.fillText('每人应收', BILL_PAD, y)
  ctx.fillStyle = '#7c5ce7'; ctx.font = '22px sans-serif'; ctx.textAlign = 'right'
  ctx.fillText(result.payersText + ' 人', W - BILL_PAD, y + 6)
  ctx.textAlign = 'left'
  y += 52

  // 每人卡片
  result.personRows.forEach(p => {
    const ch = billChipCount(p)
    const cardH = billCardHeight(p)
    ctx.fillStyle = '#ffffff'
    billRoundRect(ctx, BILL_PAD, y, W - BILL_PAD * 2, cardH, 26)
    ctx.fill()
    // 头像
    ctx.fillStyle = '#efe9ff'
    billRoundRect(ctx, BILL_PAD + 22, y + 22, 56, 56, 18)
    ctx.fill()
    ctx.fillStyle = '#7c5ce7'; ctx.font = 'bold 30px sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(p.avatar, BILL_PAD + 50, y + 50)
    ctx.textBaseline = 'top'; ctx.textAlign = 'left'
    // 名字 / 说明 / 金额
    ctx.fillStyle = '#2b2545'; ctx.font = 'bold 32px sans-serif'
    ctx.fillText(p.name, BILL_PAD + 96, y + 26)
    ctx.fillStyle = '#a39dba'; ctx.font = '20px sans-serif'
    ctx.fillText(p.sub, BILL_PAD + 96, y + 68)
    ctx.fillStyle = '#7c5ce7'; ctx.font = 'bold 40px sans-serif'; ctx.textAlign = 'right'
    ctx.fillText(p.amountText, W - BILL_PAD - 24, y + 28)
    ctx.textAlign = 'left'
    // 明细 chips
    let cy = y + 112
    for (let k = 0; k < ch; k++) {
      const c = p.chips[k]
      const col = CHIP_COLORS[c.cls] || CHIP_COLORS.s0
      ctx.fillStyle = col.bg
      billRoundRect(ctx, BILL_PAD + 24, cy, W - BILL_PAD * 2 - 48, 30, 10)
      ctx.fill()
      ctx.fillStyle = col.fg; ctx.font = '21px sans-serif'
      ctx.fillText(c.text, BILL_PAD + 34, cy + 5, W - BILL_PAD * 2 - 68)
      cy += 36
    }
    y += cardH + 16
  })

  // 说明
  y += 8
  ctx.fillStyle = '#b3accb'; ctx.font = '20px sans-serif'
  const note = '场地费按时段均摊，额外费用按所选方式分摊；分币误差用最大余额法分配，应收合计＝费用总计。'
  billWrap(ctx, note, W - BILL_PAD * 2).forEach(line => { ctx.fillText(line, BILL_PAD, y); y += 30 })

  // 页脚
  y += 18
  ctx.fillStyle = '#7c5ce7'; ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center'
  ctx.fillText('打球愉快 · 账目清爽', W / 2, y)
  ctx.textAlign = 'left'
}

function shareOrSaveImage(path: string) {
  const wxAny = wx as any
  if (typeof wxAny.showShareImageMenu === 'function') {
    wxAny.showShareImageMenu({
      path,
      needResult: false,
      fail: () => saveBillImage(path)
    })
  } else {
    saveBillImage(path)
  }
}

function saveBillImage(path: string) {
  wx.saveImageToPhotosAlbum({
    filePath: path,
    success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
    fail: (err: any) => {
      const msg = (err && err.errMsg) || ''
      if (msg.indexOf('auth') >= 0 || msg.indexOf('deny') >= 0) {
        wx.showModal({
          title: '需要相册权限',
          content: '分享图片需要保存到相册，请在设置中开启权限。',
          confirmText: '去设置',
          success: r => { if (r.confirm) wx.openSetting() }
        })
      } else {
        wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      }
    }
  })
}

const DURATIONS = [1, 2, 3, 4, 5, 6]
const DURATION_LABELS = ['1 小时', '2 小时', '3 小时', '4 小时', '5 小时', '6 小时']
const MODE_LABELS = ['按人次', '按收款人']

interface ExtraRow {
  name: string
  amount: string
  mode: 'perPerson' | 'perPayer'
  modeIndex: number
}

Component({
  data: {
    durations: DURATION_LABELS,
    durationIndex: 2,
    duration: 3,
    startHour: '',
    feeLabels: [] as string[],
    fees: ['', '', ''] as string[],
    extras: [] as ExtraRow[],
    roster: '',
    modeLabels: MODE_LABELS,
    errorMsg: '',
    showResult: false,
    result: null as CalcResult | null,
    scrollTarget: '',
    canvasShow: false
  },

  lifetimes: {
    attached() {
      this.refreshFeeLabels()
    }
  },

  methods: {
    refreshFeeLabels() {
      const labels = calculateFeeLabels(this.data.roster, this.data.duration, this.data.startHour)
      const fees = this.data.fees.slice()
      while (fees.length < labels.length) fees.push('')
      fees.length = labels.length
      this.setData({ feeLabels: labels, fees })
    },

    onDurationChange(e: WechatMiniprogram.PickerChange) {
      const index = Number(e.detail.value)
      this.setData({ durationIndex: index, duration: DURATIONS[index], showResult: false, errorMsg: '' }, () => {
        this.refreshFeeLabels()
      })
    },

    onStartHourInput(e: WechatMiniprogram.Input) {
      this.setData({ startHour: e.detail.value }, () => {
        this.refreshFeeLabels()
        this.scheduleAutoCalc()
      })
    },

    onFeeInput(e: WechatMiniprogram.Input) {
      const index = Number(e.currentTarget.dataset.index)
      const fees = this.data.fees.slice()
      fees[index] = e.detail.value
      this.setData({ fees }, () => this.scheduleAutoCalc())
    },

    onRosterInput(e: WechatMiniprogram.TextareaInput) {
      this.setData({ roster: e.detail.value }, () => {
        this.refreshFeeLabels()
        this.scheduleAutoCalc()
      })
    },

    onExtraNameInput(e: WechatMiniprogram.Input) {
      const index = Number(e.currentTarget.dataset.index)
      const extras = this.data.extras.slice()
      extras[index] = Object.assign({}, extras[index], { name: e.detail.value })
      this.setData({ extras }, () => this.scheduleAutoCalc())
    },

    onExtraAmountInput(e: WechatMiniprogram.Input) {
      const index = Number(e.currentTarget.dataset.index)
      const extras = this.data.extras.slice()
      extras[index] = Object.assign({}, extras[index], { amount: e.detail.value })
      this.setData({ extras }, () => this.scheduleAutoCalc())
    },

    onExtraModeChange(e: WechatMiniprogram.PickerChange) {
      const index = Number(e.currentTarget.dataset.index)
      const modeIndex = Number(e.detail.value)
      const extras = this.data.extras.slice()
      extras[index] = Object.assign({}, extras[index], {
        modeIndex,
        mode: modeIndex === 0 ? 'perPerson' : 'perPayer'
      })
      this.setData({ extras }, () => this.scheduleAutoCalc())
    },

    addExtra() {
      const extras = this.data.extras.slice()
      extras.push({ name: '', amount: '', mode: 'perPerson', modeIndex: 0 })
      this.setData({ extras }, () => this.scheduleAutoCalc())
    },

    removeExtra(e: WechatMiniprogram.TouchEvent) {
      const index = Number(e.currentTarget.dataset.index)
      const extras = this.data.extras.slice()
      extras.splice(index, 1)
      this.setData({ extras }, () => this.scheduleAutoCalc())
    },

    scheduleAutoCalc() {
      if (!this.data.showResult) return
      const self = this as any
      if (self.__calcTimer) clearTimeout(self.__calcTimer)
      self.__calcTimer = setTimeout(() => { self.doCalculate(false) }, 250)
    },

    onCalculate() {
      this.doCalculate(true)
    },

    doCalculate(scroll: boolean) {
      const extras: ExtraInput[] = this.data.extras.map(x => ({ name: x.name, amount: x.amount, mode: x.mode }))
      const outcome = runCalculation({
        roster: this.data.roster,
        duration: this.data.duration,
        startHour: this.data.startHour,
        fees: this.data.fees,
        extras
      })
      if (!outcome.ok) {
        this.setData({ errorMsg: outcome.error, showResult: false, result: null })
        return
      }
      this.setData({ errorMsg: '', showResult: true, result: outcome.data })
      if (scroll) {
        this.setData({ scrollTarget: 'result' })
        const self = this as any
        if (self.__scrollTimer) clearTimeout(self.__scrollTimer)
        self.__scrollTimer = setTimeout(() => { self.setData({ scrollTarget: '' }) }, 600)
      }
    },

    onReset() {
      const self = this as any
      if (self.__calcTimer) clearTimeout(self.__calcTimer)
      this.setData({
        roster: '',
        durationIndex: 2,
        duration: 3,
        startHour: '',
        fees: ['', '', ''],
        extras: [],
        errorMsg: '',
        showResult: false,
        result: null
      }, () => this.refreshFeeLabels())
    },

    onCopyBill() {
      const result = this.data.result
      if (!result) return
      const lines = result.personRows.map(p => `${p.name}  ${p.amountText}`)
      const text = `🏸 羽毛球 AA 收款清单\n费用总计 ${result.total}\n─────────────\n${lines.join('\n')}`
      wx.setClipboardData({
        data: text,
        success: () => wx.showToast({ title: '清单已复制', icon: 'success' }),
        fail: () => wx.showToast({ title: '复制失败', icon: 'none' })
      })
    },

    onShareBill() {
      const result = this.data.result
      if (!result) {
        wx.showToast({ title: '请先计算账单', icon: 'none' })
        return
      }
      const height = billImageHeight(result as CalcResult)
      const draw = () => {
        wx.showLoading({ title: '生成图片…', mask: true })
        const query = this.createSelectorQuery()
        query.select('#billCanvas').fields({ node: true, size: true }).exec(res => {
          const node = res[0] && (res[0] as any).node
          if (!node) {
            wx.hideLoading()
            wx.showToast({ title: '生成失败，请重试', icon: 'none' })
            return
          }
          try {
            const ctx = node.getContext('2d')
            // 用逻辑像素绘制：750 宽足够清晰，且避免 height*dpr 超过画布尺寸上限
            node.width = BILL_W
            node.height = height
            paintBill(ctx, result as CalcResult, height)
            wx.canvasToTempFilePath({
              canvas: node,
              x: 0, y: 0, width: BILL_W, height,
              destWidth: BILL_W, destHeight: height,
              fileType: 'png',
              success: r => {
                wx.hideLoading()
                this.setData({ canvasShow: false })
                shareOrSaveImage(r.tempFilePath)
              },
              fail: () => {
                wx.hideLoading()
                this.setData({ canvasShow: false })
                wx.showToast({ title: '图片生成失败', icon: 'none' })
              }
            })
          } catch (e) {
            wx.hideLoading()
            this.setData({ canvasShow: false })
            wx.showToast({ title: '生成失败，请重试', icon: 'none' })
          }
        })
      }
      if (this.data.canvasShow) {
        draw()
      } else {
        // 先渲染 canvas 节点，下一帧再查询，确保渲染层已就绪
        this.setData({ canvasShow: true }, () => {
          const nextTick = (wx as any).nextTick
          if (typeof nextTick === 'function') nextTick(draw)
          else setTimeout(draw, 50)
        })
      }
    }
  }
})
