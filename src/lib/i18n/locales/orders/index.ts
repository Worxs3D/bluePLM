/**
 * `orders.*` (5.11.0, schema 513): the Orders module (list pane, open order, send and export),
 * the Orders submenu of the file context menus, "Add to order" in version history, and the
 * toasts. One flat namespace, one file per locale, spread into each locale as `orders`;
 * `ordersKeys.test.ts` checks every key in every locale. `t()` has no plural rules, so counted
 * strings come in `One` / `Many` pairs.
 */

import { de } from './de'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { pt } from './pt'
import { zhCN } from './zhCN'
import { zhTW } from './zhTW'

export type OrdersKey = keyof typeof en
export type OrdersDict = Record<OrdersKey, string>

export const ordersStrings: Record<'en' | 'de' | 'es' | 'fr' | 'pt' | 'zhCN' | 'zhTW', OrdersDict> = {
  en,
  de,
  es,
  fr,
  pt,
  zhCN,
  zhTW,
}
