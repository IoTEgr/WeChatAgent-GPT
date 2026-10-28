"""Bounded startup recovery and independent per-conversation polling progress."""
import hashlib
import json
import re
import pathlib
import math

LOOKBACK_SECONDS = 24 * 60 * 60
OVERLAP_SECONDS = 10 * 60
HISTORY_LIMIT = 500


def message_identity(talker, message):
    return hashlib.sha256(json.dumps([talker, message.get('serverId'),
        message.get('localId'), message.get('createTime')], separators=(',', ':')).encode()).hexdigest()


def reply_signal(payload, project, own_wxid):
    if payload.get('sessionType') == 'private' or payload.get('pat'):
        return True
    text = payload.get('content', '')
    wechat = project.get('wechat', {})
    if any(word and word in text for word in wechat.get('wake_words', [])):
        return True
    if any(name and re.search('@' + re.escape(name) + r'(?:\s|$)', text)
           for name in project.get('account', {}).get('nicknames', [])):
        return True
    reference = payload.get('quoteReply', {}).get('reference', {})
    if reference.get('senderId') == own_wxid and reference.get('conversationId') in ('', payload.get('sessionId')):
        return True
    # This only queues a social decision; it is not a command to answer.
    return bool(re.search(r'(?:有人|谁|请问|帮忙|求助|急).{0,60}[?？]|(?:紧急|急事|求助).{0,60}(?:帮|处理|怎么办)', text))


class MessageSync:
    def __init__(self, reader, now, persist=True):
        self.reader = reader
        self.started_at = now
        self.cursors = {}
        self.observed = {}
        self.persist = persist
        self.account_scope = hashlib.sha256((str(getattr(reader,'account',reader.root).resolve())+'\0'+reader.own_wxid).encode()).hexdigest()
        self.file = reader.root/'state/message-sync'/(self.account_scope+'.json')
        self.read_ids = {}
        if self.file.exists():
            if self.file.stat().st_size>8*1024*1024:
                raise RuntimeError('MESSAGE_SYNC_STATE_TOO_LARGE')
            state=json.loads(self.file.read_text(encoding='utf-8'))
            if state.get('version')!=1 or state.get('accountScope')!=self.account_scope or not isinstance(state.get('read'),dict):
                raise RuntimeError('MESSAGE_SYNC_STATE_INVALID')
            for identity,at in state['read'].items():
                if not re.fullmatch('[a-f0-9]{64}',identity) or not isinstance(at,(int,float)) or not math.isfinite(at):
                    raise RuntimeError('MESSAGE_SYNC_STATE_INVALID')
                if at>=now-LOOKBACK_SECONDS:self.read_ids[identity]=at

    def buffered_ids(self, key, now):
        file = self.reader.root / 'state/social-messages.json'
        if not file.exists():
            return set(self.read_ids)
        if file.stat().st_size > 32 * 1024 * 1024:
            raise RuntimeError('MESSAGE_BUFFER_TOO_LARGE')
        data = json.loads(file.read_text(encoding='utf-8-sig'))
        if data.get('version') != 1 or not isinstance(data.get('chats'), dict):
            raise RuntimeError('MESSAGE_BUFFER_INVALID')
        before=dict(self.read_ids)
        for rows in data['chats'].values():
            for row in rows:
                identity=row.get('message_id','')
                at=row.get('timestamp',now)
                if not row.get('outgoing') and row.get('processed') is True and re.fullmatch('[a-f0-9]{64}',identity) and isinstance(at,(int,float)) and math.isfinite(at) and at>=now-LOOKBACK_SECONDS:
                    self.read_ids[identity]=at
        self.read_ids=dict(sorted(((identity,at) for identity,at in self.read_ids.items() if at>=now-LOOKBACK_SECONDS),key=lambda item:item[1])[-50000:])
        if self.persist and self.read_ids!=before:
            self.file.parent.mkdir(parents=True,exist_ok=True)
            temp=self.file.with_suffix('.tmp')
            temp.write_text(json.dumps({'version':1,'accountScope':self.account_scope,'read':self.read_ids}),encoding='utf-8')
            temp.replace(self.file)
        return set(self.read_ids)|{row.get('message_id') for row in data['chats'].get(key, []) if not row.get('outgoing')}

    def scan(self, talker, now, project):
        first = talker not in self.cursors
        lower = max(now - LOOKBACK_SECONDS, self.cursors.get(talker, now) - OVERLAP_SECONDS)
        if first:
            lower = now - LOOKBACK_SECONDS
        messages = self.reader.messages(talker, limit=HISTORY_LIMIT if first else 0, from_time=lower)
        rows = sorted(messages, key=lambda row: (row.get('createTime', 0), row.get('localId', 0)))
        key = 'wechat:' + ('group:' if '@chatroom' in talker else 'private:') + self.reader.conversation_id(talker)
        known = self.buffered_ids(key, now)
        observed = self.observed.setdefault(talker, {})
        own_latest = max((row.get('createTime', 0) for row in rows if row.get('isSend')), default=0)
        pending, context = [], []
        for row in rows:
            identity = message_identity(talker, row)
            if identity in known or identity in observed:
                continue
            payload = self.reader.make_payload(talker, row)
            if not payload:
                continue
            old = row.get('createTime', 0) < self.started_at
            if old:
                needs_review = row.get('createTime', 0) > own_latest and reply_signal(payload, project, self.reader.own_wxid)
                payload['historyContext'] = not needs_review
                payload['recoveredUnread'] = needs_review
            (context if payload.get('historyContext') else pending).append(payload)
        # Keep a large backlog to a single recent decision batch. Earlier rows remain readable context.
        recoverable = [payload for payload in pending if payload.get('recoveredUnread')]
        if len(recoverable)>20:
            overflow = {payload['rawid'] for payload in recoverable[:-20]}
            for payload in pending:
                if payload['rawid'] in overflow:
                    payload['historyContext']=True
                    payload['recoveredUnread']=False
                    context.append(payload)
            pending=[payload for payload in pending if payload['rawid'] not in overflow]
        # Load background before waking the model, even when a direct question is early in the batch.
        return sorted(context,key=lambda payload:payload['timestamp']) + pending, now

    def commit(self, talker, payloads, cursor, now):
        observed = self.observed.setdefault(talker, {})
        for payload in payloads:
            observed[payload['rawid']] = now
        cutoff = now - OVERLAP_SECONDS - 30
        self.observed[talker] = {identity: at for identity, at in observed.items() if at >= cutoff}
        if cursor is not None:
            self.cursors[talker] = cursor
