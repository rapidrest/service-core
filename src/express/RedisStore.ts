///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { SessionData, Store } from "express-session";
import { Redis } from "ioredis";

export class RedisStore extends Store {
  constructor(private client: Redis, private prefix = "sess:") {
    super()
  }

  public get(sid: string, callback: (err: any, session?: SessionData | null) => void) {
    this.client.get(this.prefix + sid)
      .then(data => {
        if (!data) return callback(null, null)
        callback(null, JSON.parse(data))
      })
      .catch(err => callback(err))
  }

  public set(sid: string, session: SessionData, callback?: (err?: any) => void) {
    const ttl = session.cookie?.maxAge
      ? Math.floor(session.cookie.maxAge / 1000)
      : 86400 // default 1 day

    this.client.setex(this.prefix + sid, ttl, JSON.stringify(session))
      .then(() => callback?.())
      .catch(err => callback?.(err))
  }

  public destroy(sid: string, callback?: (err?: any) => void) {
    this.client.del(this.prefix + sid)
      .then(() => callback?.())
      .catch(err => callback?.(err))
  }
}