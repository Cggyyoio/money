import { Book } from '../js/domain/book.js';
import { MemoryDriver } from '../js/data/memory-driver.js';

export async function newBook(start = '2026-10-05T10:00:00.000Z') {
  let t = new Date(start).getTime();
  const clock = { tick: (ms = 60000) => { t += ms; }, set: (iso) => { t = new Date(iso).getTime(); }, now: () => new Date(t) };
  const driver = new MemoryDriver();
  const book = await new Book(driver, { now: clock.now, device: 'test' }).init();
  return { book, clock, driver };
}
/** Standard fixture from the spec: Vodafone 20,000 / Cash 5,000 / Bank 30,000 */
export async function spec() {
  const ctx = await newBook();
  const { book } = ctx;
  ctx.vf = await book.createAccount({ name: 'Vodafone Cash', type: 'wallet', currency: 'EGP', opening: '20000' });
  ctx.cash = await book.createAccount({ name: 'Cash', type: 'cash', currency: 'EGP', opening: '5000' });
  ctx.bank = await book.createAccount({ name: 'Bank', type: 'bank', currency: 'EGP', opening: '30000' });
  return ctx;
}
export const bal = (book, a) => book.balanceBig(a.id);
