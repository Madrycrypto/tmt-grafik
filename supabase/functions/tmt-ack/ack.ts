// Powiadomienie dla autora wiadomości o potwierdzeniu odbioru (bez sieci — testowane w src/domain/ack.test.ts).
// Mała grupa: push przy każdym potwierdzeniu. Duża grupa: jeden push, gdy potwierdzi ostatnia osoba.

export const ACK_EACH_MAX = 5;

export interface AckInput {
  title: string | null;
  /** adresaci wiadomości */
  total: number;
  /** ile osób potwierdziło po tym zapisie */
  confirmed: number;
  /** imiona osób, które potwierdziły właśnie teraz */
  names: string[];
}

export function ackPush(m: AckInput, lang: string): { title: string; body: string } | null {
  if (!m.names.length) return null;
  const zh = lang === 'zh';
  const what = m.title ?? (zh ? '消息' : 'Wiadomość');
  if (m.total <= ACK_EACH_MAX) {
    return { title: `✓ ${what}`, body: zh ? `${m.names.join('、')} 已确认收到（${m.confirmed}/${m.total}）` : `${m.names.join(', ')} potwierdził(a) odbiór (${m.confirmed}/${m.total})` };
  }
  if (m.confirmed >= m.total) {
    return { title: `✓ ${what}`, body: zh ? `全部 ${m.total} 人已确认收到` : `Wszyscy potwierdzili odbiór (${m.total}/${m.total})` };
  }
  return null;
}
