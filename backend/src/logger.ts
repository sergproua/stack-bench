type LogLevel = 'INFO' | 'WARN' | 'ERROR';

const formatMessage = (level: LogLevel, file: string, message: string) => {
  const timestamp = new Date().toISOString();
  return `${timestamp} [${level}] [${file}] ${message}`;
};

const writeLine = (level: LogLevel, file: string, message: string) => {
  const line = formatMessage(level, file, message);
  if (level === 'ERROR') {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
};

const formatError = (value: unknown) => {
  if (value instanceof Error) {
    return value.stack ? `${value.message}\n${value.stack}` : value.message;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const createLogger = (file: string) => ({
  info: (message: string) => writeLine('INFO', file, message),
  warn: (message: string) => writeLine('WARN', file, message),
  error: (message: string | unknown) => writeLine('ERROR', file, typeof message === 'string' ? message : formatError(message)),
});
