import { PanelPlugin } from '@grafana/data';
import { AdminPanel } from './components/AdminPanel';
import { PluginOptions } from './types';

export const plugin = new PanelPlugin<PluginOptions>(AdminPanel)
  .setPanelOptions((builder) => {
    builder
      .addTextInput({
        path: 'yggdrasilUrl',
        name: 'Yggdrasil URL',
        description: 'Base URL of the Yggdrasil server (e.g. http://localhost:3000)',
        defaultValue: 'http://localhost:3000',
      })
      .addTextInput({
        path: 'adminApiKey',
        name: 'Admin API Key',
        description: 'API key for X-Admin-Api-Key header',
        defaultValue: '',
      });
    return builder;
  });
