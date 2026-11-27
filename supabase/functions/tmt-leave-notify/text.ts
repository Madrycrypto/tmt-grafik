// Treść powiadomienia o odrzuconym zgłoszeniu urlopu (bez sieci — testowane w src/domain/leaveNotify.test.ts).
export function rejectedPush(date: string, lang: string): { title: string; body: string } {
  const [y, m, d] = date.split('-');
  const short = `${d}.${m}.${y}`;
  return lang === 'zh'
    ? { title: '休假申请被拒绝', body: `${short} 的休假申请未获批准，请联系组长。` }
    : { title: 'Zgłoszenie urlopu odrzucone', body: `Urlop na ${short} nie został zaakceptowany. Skontaktuj się z liderem.` };
}
