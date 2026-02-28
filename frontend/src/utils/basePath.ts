const normalizeBasePath = (value?: string): string => {
  const raw = (value || '').trim();
  if (!raw || raw === '/') {
    return '';
  }

  let base = raw.charAt(0) === '/' ? raw : `/${raw}`;
  while (base.length > 1 && base.slice(-1) === '/') {
    base = base.slice(0, -1);
  }
  return base;
};

export const BASE_PATH = normalizeBasePath(import.meta.env.BASE_URL);
export const API_PATH = `${BASE_PATH}/api`;
export const SOCKET_IO_PATH = `${BASE_PATH}/socket.io`;
