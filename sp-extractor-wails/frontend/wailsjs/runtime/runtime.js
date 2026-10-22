/* Runtime polyfill for both Wails Desktop and Web Browser */

const isDesktop = typeof window !== 'undefined' && !!(window['runtime'] && window['runtime']['EventsOn']);

const listeners = new Map();

export function EventsOnMultiple(eventName, callback, maxCallbacks) {
  if (isDesktop && window.runtime && window.runtime.EventsOnMultiple) {
    return window.runtime.EventsOnMultiple(eventName, callback, maxCallbacks);
  }
  if (!listeners.has(eventName)) {
    listeners.set(eventName, new Set());
  }
  let count = 0;
  const handler = (...args) => {
    callback(...args);
    if (maxCallbacks > 0) {
      count++;
      if (count >= maxCallbacks) {
        EventsOff(eventName, handler);
      }
    }
  };
  listeners.get(eventName).add(handler);
  return () => EventsOff(eventName, handler);
}

export function EventsOn(eventName, callback) {
  return EventsOnMultiple(eventName, callback, -1);
}

export function EventsOff(eventName, ...additionalCallbacks) {
  if (isDesktop && window.runtime && window.runtime.EventsOff) {
    return window.runtime.EventsOff(eventName, ...additionalCallbacks);
  }
  const set = listeners.get(eventName);
  if (set) {
    if (additionalCallbacks.length === 0) {
      listeners.delete(eventName);
    } else {
      for (const cb of additionalCallbacks) {
        set.delete(cb);
      }
    }
  }
}

export function EventsOffAll() {
  if (isDesktop && window.runtime && window.runtime.EventsOffAll) {
    return window.runtime.EventsOffAll();
  }
  listeners.clear();
}

export function EventsOnce(eventName, callback) {
  return EventsOnMultiple(eventName, callback, 1);
}

export function EventsEmit(eventName, ...args) {
  if (isDesktop && window.runtime && window.runtime.EventsEmit) {
    return window.runtime.EventsEmit(eventName, ...args);
  }
  const set = listeners.get(eventName);
  if (set) {
    for (const cb of Array.from(set)) {
      try {
        cb(...args);
      } catch (err) {
        console.error('Error in event listener:', err);
      }
    }
  }
}

export function BrowserOpenURL(url) {
  if (isDesktop && window.runtime && window.runtime.BrowserOpenURL) {
    return window.runtime.BrowserOpenURL(url);
  }
  if (url && !url.startsWith('file://')) {
    window.open(url, '_blank');
  }
}

export function LogPrint(message) { if (isDesktop && window.runtime?.LogPrint) window.runtime.LogPrint(message); else console.log(message); }
export function LogTrace(message) { if (isDesktop && window.runtime?.LogTrace) window.runtime.LogTrace(message); else console.trace(message); }
export function LogDebug(message) { if (isDesktop && window.runtime?.LogDebug) window.runtime.LogDebug(message); else console.debug(message); }
export function LogInfo(message) { if (isDesktop && window.runtime?.LogInfo) window.runtime.LogInfo(message); else console.info(message); }
export function LogWarning(message) { if (isDesktop && window.runtime?.LogWarning) window.runtime.LogWarning(message); else console.warn(message); }
export function LogError(message) { if (isDesktop && window.runtime?.LogError) window.runtime.LogError(message); else console.error(message); }
export function LogFatal(message) { if (isDesktop && window.runtime?.LogFatal) window.runtime.LogFatal(message); else console.error('FATAL:', message); }

export function WindowReload() { if (isDesktop && window.runtime?.WindowReload) window.runtime.WindowReload(); else window.location.reload(); }
export function WindowReloadApp() { if (isDesktop && window.runtime?.WindowReloadApp) window.runtime.WindowReloadApp(); else window.location.reload(); }
export function WindowSetAlwaysOnTop(b) { if (isDesktop && window.runtime?.WindowSetAlwaysOnTop) window.runtime.WindowSetAlwaysOnTop(b); }
export function WindowSetSystemDefaultTheme() { if (isDesktop && window.runtime?.WindowSetSystemDefaultTheme) window.runtime.WindowSetSystemDefaultTheme(); }
export function WindowSetLightTheme() { if (isDesktop && window.runtime?.WindowSetLightTheme) window.runtime.WindowSetLightTheme(); }
export function WindowSetDarkTheme() { if (isDesktop && window.runtime?.WindowSetDarkTheme) window.runtime.WindowSetDarkTheme(); }
export function WindowCenter() { if (isDesktop && window.runtime?.WindowCenter) window.runtime.WindowCenter(); }
export function WindowSetTitle(title) { if (isDesktop && window.runtime?.WindowSetTitle) window.runtime.WindowSetTitle(title); else document.title = title; }
export function WindowFullscreen() { if (isDesktop && window.runtime?.WindowFullscreen) window.runtime.WindowFullscreen(); }
export function WindowUnfullscreen() { if (isDesktop && window.runtime?.WindowUnfullscreen) window.runtime.WindowUnfullscreen(); }
