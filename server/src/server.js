import { createApp } from './app.js';
import { config } from './config.js';

const app = await createApp();
app.listen(config.server.port, () => {
  console.log(`[mpa-preview-studio] 服务已启动: http://localhost:${config.server.port}`);
  console.log(`[platform] ${config.platform.name} · 能力配置 ${config.platform.capabilityVersion}`);
});
