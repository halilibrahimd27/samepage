import { expose } from 'comlink';
import type { PipelineApi } from './api';

const api: PipelineApi = {
  ping() {
    return 'pong';
  },
};

expose(api);
