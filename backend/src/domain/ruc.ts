/** Validación de RUC ecuatoriano (13 dígitos, dígito verificador por tipo de contribuyente). */

function mod10(digits: number[]) {
  const sum = digits.slice(0, 9).reduce((acc, d, i) => {
    const v = d * (i % 2 === 0 ? 2 : 1);
    return acc + (v > 9 ? v - 9 : v);
  }, 0);
  return (10 - (sum % 10)) % 10;
}

function mod11(digits: number[], coefficients: number[]) {
  const sum = coefficients.reduce((acc, c, i) => acc + c * digits[i], 0);
  const rest = sum % 11;
  return rest === 0 ? 0 : 11 - rest;
}

/** true si el RUC tiene provincia, tipo, dígito verificador y establecimiento válidos. */
export function isValidEcuadorRuc(value: string | undefined | null): boolean {
  const ruc = String(value ?? '').trim();
  if (!/^\d{13}$/.test(ruc)) return false;
  const d = ruc.split('').map(Number);
  const province = Number(ruc.slice(0, 2));
  if (!((province >= 1 && province <= 24) || province === 30)) return false;
  const third = d[2];
  if (third < 6) {
    // Persona natural: cédula + establecimiento 001 en adelante.
    return mod10(d) === d[9] && Number(ruc.slice(10)) >= 1;
  }
  if (third === 6) {
    // Entidad pública: verificador en la posición 9.
    return mod11(d, [3, 2, 7, 6, 5, 4, 3, 2]) === d[8] && Number(ruc.slice(9)) >= 1;
  }
  if (third === 9) {
    // Sociedad privada: verificador en la posición 10.
    return mod11(d, [4, 3, 2, 7, 6, 5, 4, 3, 2]) === d[9] && Number(ruc.slice(10)) >= 1;
  }
  return false;
}

/**
 * El dígito verificador solo se exige en producción o con OPTICLEAN_STRICT_RUC=1.
 * La demo y los datos de prueba usan RUC de ejemplo que no cumplen el algoritmo.
 */
export function strictRucEnabled() {
  const flag = process.env.OPTICLEAN_STRICT_RUC;
  if (flag === '1') return true;
  if (flag === '0') return false;
  return process.env.NODE_ENV === 'production';
}

/** Lanza si el RUC no es válido. `previous` evita bloquear fichas existentes que no cambian de RUC. */
export function assertRuc(taxId: string, label = 'RUC', previous?: string) {
  if (!/^\d{13}$/.test(taxId)) throw new Error(`El ${label} debe tener 13 dígitos.`);
  if (strictRucEnabled() && taxId !== previous && !isValidEcuadorRuc(taxId)) {
    throw new Error(`El ${label} no es válido: revisa el dígito verificador.`);
  }
}
