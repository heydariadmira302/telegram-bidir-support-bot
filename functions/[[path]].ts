import { handleRequest } from '../src/app';
import type { Env } from '../src/types';

export const onRequest: PagesFunction<Env> = async (context) => {
  return handleRequest(context.request, context.env, context);
};
