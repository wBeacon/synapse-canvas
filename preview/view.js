import { layoutConversations } from '../core/conversation.js'

export function formatHostReference(title, turn) {
  const clip = (text, limit) => String(text ?? '').length > limit
    ? `${String(text).slice(0, limit)}\n…引用已截断，请在原会话查看全文` : String(text ?? '')
  return `引用自 WorkBuddy 会话「${clip(title, 120)}」：\n\n问题：${clip(turn.question.text, 4000)}\n\n回复：${clip(turn.answer?.text, 8000)}\n\n请基于以上引用继续讨论：`
}

export function mountPreview(transport) {
  const $ = selector => document.querySelector(selector)
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const state = { data: null, selected: null, workspace: '', query: '', zoom: 1, x: 0, y: 0, positions: new Map(), graph: { cards: [], edges: [] }, gesture: null, busy: false, detail: null }
  const api = path => transport.get(path)

  function visibleSessions() {
    const query = state.query.toLocaleLowerCase()
    return (state.data?.sessions ?? []).filter(session =>
      (!state.workspace || session.workspace.id === state.workspace)
      && (!query || session.title.toLocaleLowerCase().includes(query)
        || session.turns.some(turn => turn.question.text.toLocaleLowerCase().includes(query))))
  }

  function transform() {
    $('#world').style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.zoom})`
    $('#zoom').textContent = `${Math.round(state.zoom * 100)}%`
  }

  function drawEdges() {
    const index = new Map(state.graph.cards.map(card => [card.id, card]))
    $('#edges').innerHTML = state.graph.edges.map(edge => {
      const from = index.get(edge.from), to = index.get(edge.to)
      const x = from.x + 310, y = from.y + 138, endX = to.x, endY = to.y + 138
      return `<path d="M ${x} ${y} C ${x + 28} ${y}, ${endX - 28} ${endY}, ${endX} ${endY}"></path>`
    }).join('')
  }

  function renderMap() {
    const scrolls = new Map([...document.querySelectorAll('.thread-card')].map(card => [card.dataset.card, card.querySelector('.thread-answer').scrollTop]))
    const sessions = visibleSessions().filter(session => !state.selected || session.id === state.selected)
    state.graph = layoutConversations(sessions)
    const sessionIndex = new Map(sessions.map(session => [session.id, session]))
    for (const card of state.graph.cards) Object.assign(card, state.positions.get(card.id))
    $('#cards').innerHTML = state.graph.cards.map(card => {
      const session = sessionIndex.get(card.sessionId), turn = card.turn
      const order = session.turns.findIndex(item => item.id === turn.id) + 1
      const answer = turn.answer?.text || (turn.error ? turn.error.text : '尚无已保存的回复')
      return `<article class="thread-card${state.detail?.id === card.id ? ' selected' : ''}" data-card="${escape(card.id)}" style="left:${card.x}px;top:${card.y}px">
        <div class="thread-card-head" data-drag="${escape(card.id)}"><span class="topic-dot"></span><strong title="${escape(turn.question.text)}">${escape(turn.question.text)}</strong></div>
        <div class="thread-meta"><span>第 ${order} 轮</span><span>${escape(session.workspace.title)}</span>${turn.tools.length ? `<span class="card-process-count">工具 ${turn.tools.length}</span>` : ''}</div>
        <div class="thread-answer">${escape(answer)}${turn.answer?.truncated ? '\n…详情查看全文' : ''}</div>
        <footer><span>${escape(transport.sourceLabel ?? 'WorkBuddy · 已保存记录')}</span><button data-detail="${escape(card.id)}">查看详情</button></footer>
      </article>`
    }).join('')
    for (const card of document.querySelectorAll('.thread-card')) card.querySelector('.thread-answer').scrollTop = scrolls.get(card.dataset.card) ?? 0
    drawEdges()
    $('#empty').hidden = state.graph.cards.length > 0
    $('#count').textContent = `${sessions.length} 个会话 · ${state.graph.cards.length} 轮对话`
    $('#heading').textContent = state.selected ? sessionIndex.get(state.selected)?.title || '会话地图' : '会话地图'
    transform()
  }

  function renderSidebar() {
    const sessions = visibleSessions()
    $('#sessions').innerHTML = `<button class="tree-row${state.selected === null ? ' active' : ''}" data-session=""><span>全部会话</span><small>${sessions.length}</small></button>`
      + sessions.map(session => `<button class="tree-row${state.selected === session.id ? ' active' : ''}" data-session="${escape(session.id)}"><span>${escape(session.title)}</span><small>${session.turns.length} 轮</small></button>`).join('')
    const workspaces = new Map((state.data?.sessions ?? []).map(session => [session.workspace.id, session.workspace.title]))
    $('#workspace').innerHTML = '<option value="">全部工作区</option>' + [...workspaces].map(([id, title]) => `<option value="${escape(id)}">${escape(title)}</option>`).join('')
    $('#workspace').value = state.workspace
  }

  function focusMap() {
    const cards = state.graph.cards
    if (cards.length) {
      const left = Math.min(...cards.map(card => card.x)), top = Math.min(...cards.map(card => card.y))
      const width = Math.max(...cards.map(card => card.x + 310)) - left
      const height = Math.max(...cards.map(card => card.y + 276)) - top
      state.zoom = Math.max(0.2, Math.min(1, ($('#viewport').clientWidth - 64) / width, ($('#viewport').clientHeight - 64) / height))
      state.x = 32 - left * state.zoom
      state.y = 32 - top * state.zoom
    } else { state.x = 0; state.y = 0 }
    transform()
  }

  function zoomBy(factor, point = { x: $('#viewport').clientWidth / 2, y: $('#viewport').clientHeight / 2 }) {
    const zoom = Math.max(0.2, Math.min(4, state.zoom * factor))
    state.x = point.x - (point.x - state.x) * zoom / state.zoom
    state.y = point.y - (point.y - state.y) * zoom / state.zoom
    state.zoom = zoom
    transform()
  }

  function showNotice(text) { $('#notice').textContent = text; $('#notice').hidden = !text }

  async function refresh() {
    if (state.busy || state.gesture) return
    state.busy = true
    $('#refresh').disabled = true
    try {
      const data = await api('/api/snapshot')
      const first = state.data === null
      if (data.revision !== state.data?.revision) {
        state.data = data
        if (!data.sessions.some(session => session.id === state.selected)) state.selected = null
        if (!data.sessions.some(session => session.workspace.id === state.workspace)) state.workspace = ''
        if (state.detail && !data.sessions.some(session => session.id === state.detail.sessionId)) $('#detail').close()
        renderSidebar()
        renderMap()
        if (first) focusMap()
      }
      showNotice(data.warnings.join('；'))
      $('#sync').textContent = `已更新 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`
    } catch (error) {
      showNotice(error.message)
      $('#sync').textContent = state.data ? '当前显示上次读取结果' : '读取失败'
    } finally { state.busy = false; $('#refresh').disabled = false }
  }

  async function showDetail(card) {
    state.detail = { id: card.id, sessionId: card.sessionId }
    $('#detail-title').textContent = '对话详情'
    $('#detail-body').textContent = '正在读取'
    $('#detail').showModal()
    try {
      const { session } = await api(`/api/sessions/${encodeURIComponent(card.sessionId)}`)
      if (state.detail?.id !== card.id) return
      const turn = session.turns.find(item => item.id === card.id)
      if (!turn) throw new Error('这轮记录已发生变化，请刷新地图')
      $('#detail-title').textContent = session.title
      const message = (label, event) => event ? `<div class="detail-label">${label}</div><div class="detail-message">${escape(event.text)}${event.truncated ? '\n…内容过长，请在 WorkBuddy 查看剩余内容' : ''}</div>` : ''
      $('#detail-body').innerHTML = message('你的问题', turn.question)
        + turn.answers.map((answer, index) => message(turn.answers.length > 1 ? `助手回复 ${index + 1}` : '助手回复', answer)).join('')
        + message('执行状态', turn.error)
        + (turn.tools.length ? '<div class="detail-label">工具过程</div>' + turn.tools.map(tool => `<div class="tool-row">${escape(tool.name)} · ${{ done: '已完成', failed: '失败', pending: '尚无已保存的结果' }[tool.status]}</div>`).join('') : '')
      if (transport.sendHostMessage) {
        const quote = document.createElement('button')
        quote.textContent = '发送引用到当前任务'
        quote.addEventListener('click', async () => {
          quote.disabled = true
          try {
            await transport.sendHostMessage(formatHostReference(session.title, turn))
            $('#detail').close()
          } catch { quote.disabled = false; quote.textContent = '发送失败，点击重试' }
        })
        const description = document.createElement('p')
        description.className = 'preview-footnote'
        description.textContent = '将本轮问答作为新消息发送到当前任务，并触发助手回复。'
        $('#detail-body').append(description, quote)
      }
    } catch (error) { $('#detail-body').textContent = error.message }
  }

  $('#sessions').addEventListener('click', event => {
    const button = event.target.closest('[data-session]')
    if (!button) return
    state.selected = button.dataset.session || null
    renderSidebar(); renderMap(); focusMap()
  })
  $('#search').addEventListener('input', event => { state.query = event.target.value; state.selected = null; renderSidebar(); renderMap(); focusMap() })
  $('#workspace').addEventListener('change', event => { state.workspace = event.target.value; state.selected = null; renderSidebar(); renderMap(); focusMap() })
  $('#cards').addEventListener('click', event => {
    const button = event.target.closest('[data-detail]')
    const card = button && state.graph.cards.find(card => card.id === button.dataset.detail)
    if (card) void showDetail(card)
  })
  $('#close-detail').addEventListener('click', () => $('#detail').close())
  $('#detail').addEventListener('close', () => { state.detail = null })
  $('#refresh').addEventListener('click', refresh)
  $('#fit').addEventListener('click', focusMap)
  $('#zoom-in').addEventListener('click', () => zoomBy(1.2))
  $('#zoom-out').addEventListener('click', () => zoomBy(1 / 1.2))
  $('#viewport').addEventListener('wheel', event => {
    if (event.target.closest('.thread-answer') && !event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    if (event.ctrlKey || event.metaKey) {
      const rect = $('#viewport').getBoundingClientRect()
      zoomBy(Math.exp(-event.deltaY * 0.01), { x: event.clientX - rect.left, y: event.clientY - rect.top })
    } else { state.x -= event.deltaX; state.y -= event.deltaY; transform() }
  }, { passive: false })
  $('#viewport').addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button, .thread-answer')) return
    const handle = event.target.closest('[data-drag]')
    const card = handle && state.graph.cards.find(item => item.id === handle.dataset.drag)
    state.gesture = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x: card?.x ?? state.x, y: card?.y ?? state.y, card }
    $('#viewport').setPointerCapture(event.pointerId)
    event.preventDefault()
  })
  $('#viewport').addEventListener('pointermove', event => {
    const gesture = state.gesture
    if (!gesture || gesture.pointer !== event.pointerId) return
    const dx = event.clientX - gesture.startX, dy = event.clientY - gesture.startY
    if (gesture.card) {
      gesture.card.x = gesture.x + dx / state.zoom; gesture.card.y = gesture.y + dy / state.zoom
      state.positions.set(gesture.card.id, { x: gesture.card.x, y: gesture.card.y })
      const node = [...$('#cards').children].find(node => node.dataset.card === gesture.card.id)
      node.style.left = `${gesture.card.x}px`; node.style.top = `${gesture.card.y}px`
      drawEdges()
    } else { state.x = gesture.x + dx; state.y = gesture.y + dy; transform() }
  })
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) $('#viewport').addEventListener(type, () => { state.gesture = null })
  void refresh()
  window.setInterval(() => { if (!document.hidden) void refresh() }, 2000)
  transport.onScopeChange?.(() => {
    state.data = null; state.selected = null; state.positions.clear()
    if ($('#detail').open) $('#detail').close()
    renderSidebar(); renderMap(); void refresh()
  })
  return { refresh }
}
