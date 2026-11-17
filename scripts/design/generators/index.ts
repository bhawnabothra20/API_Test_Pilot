/** Registered category generators. Order matters: it fixes the case ids (TC_..._NNN) and the faker sequence. */
import type { CategoryGenerator } from '../plugin';
import { generator as positiveFunctional } from './positive-functional';
import { generator as dataValidation } from './data-validation';
import { generator as negative } from './negative';
import { generator as boundary } from './boundary';
import { generator as auth } from './auth';
import { generator as authorization } from './authorization';

export const GENERATORS: readonly CategoryGenerator[] = [positiveFunctional, dataValidation, negative, boundary, auth, authorization];
