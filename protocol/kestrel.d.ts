export type KestrelAction =
  | 'status'
  | 'goto'
  | 'snapshot'
  | 'click'
  | 'type'
  | 'fill_form'
  | 'select'
  | 'press'
  | 'scroll'
  | 'wait_for'
  | 'extract'
  | 'screenshot'
  | 'tabs'
  | 'switch_tab'
  | 'new_tab'
  | 'close_tab'
  | 'back'
  | 'forward'
  | 'assert'
  | 'detect_captcha'
  | 'record_start'
  | 'record_status'
  | 'record_stop'
  | 'replay'
  | 'report';

export interface TargetArgs {
  ref?: string;
  som?: string | number;
  selector?: string;
  text?: string;
  role?: string;
  name?: string;
}

export interface VerifyArgs {
  expectText?: string;
  expectGone?: string;
  expectUrl?: string;
}

export interface VerifyBlock {
  urlBefore: string;
  urlAfter: string;
  urlChanged: boolean;
  title?: string;
  expectText?: string;
  expectTextFound?: boolean;
  expectGone?: string;
  expectGoneConfirmed?: boolean;
  expectUrl?: string;
  expectUrlMatched?: boolean;
  newConsoleErrors: Array<Record<string, unknown>>;
  failedRequests: string[];
  [key: string]: unknown;
}

export interface KestrelResponse {
  ok: boolean;
  error?: string;
  verify?: VerifyBlock;
  [key: string]: unknown;
}

export interface GotoArgs extends VerifyArgs {
  url: string;
}

export interface ClickArgs extends TargetArgs, VerifyArgs {
  confirm?: boolean;
}

export interface TypeArgs extends TargetArgs, VerifyArgs {
  text: string;
  submit?: boolean;
}

export interface FillFormArgs extends VerifyArgs {
  fields: Array<TargetArgs & { text: string }>;
}

export interface PressArgs extends VerifyArgs {
  keys: string;
}

export interface RecordStartArgs {
  name?: string;
}

export interface RecordStopArgs {
  path?: string;
}

export interface ReplayArgs {
  path: string;
  stopOnFailure?: boolean;
}

export interface ReportArgs {
  path?: string;
  format?: 'json' | 'md';
  limit?: number;
}

export type KestrelRequest =
  | { action: 'goto'; args: GotoArgs }
  | { action: 'click'; args: ClickArgs }
  | { action: 'type'; args: TypeArgs }
  | { action: 'fill_form'; args: FillFormArgs }
  | { action: 'press'; args: PressArgs }
  | { action: 'record_start'; args?: RecordStartArgs }
  | { action: 'record_stop'; args?: RecordStopArgs }
  | { action: 'replay'; args: ReplayArgs }
  | { action: 'report'; args?: ReportArgs }
  | { action: KestrelAction; args?: Record<string, unknown> };
