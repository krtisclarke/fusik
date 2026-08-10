import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Development-only debug handle: lets us inspect the engine/store and render
// voices offline to verify they actually produce sound. Never shipped (guarded
// by import.meta.env.DEV, which is compiled out of production builds).
if (import.meta.env.DEV) {
  void Promise.all([
    import('./audio/AudioEngine'),
    import('./state/store'),
    import('./audio/synth'),
    import('./model/voices'),
  ]).then(([engineMod, storeMod, synthMod, voicesMod]) => {
    (window as unknown as Record<string, unknown>).beatbox = {
      engine: engineMod.engine,
      store: storeMod.useStore,
      getTrigger: synthMod.getTrigger,
      resolveParams: voicesMod.resolveParams,
    };
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
