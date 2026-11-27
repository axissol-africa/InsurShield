import { env } from '@/config/env';
import * as http from './http';
import * as mock from './mock';

export const api = env.apiMode === 'http' ? http : mock;
