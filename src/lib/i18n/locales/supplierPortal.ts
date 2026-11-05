/**
 * `supplierPortal.*` (5.13.0): the Supplier Portal sidebar, which shows the organization's quote
 * orders. RFQs became quote orders in 5.13.0 (schema 515 imports them). Spread into each locale as
 * `supplierPortal`; `supplierPortalKeys.test.ts` checks every key in every locale.
 */
type NamespaceDict = Record<string, string>

const en: NamespaceDict = {
  subtitle: 'Quote orders and suppliers',
  newQuote: 'New quote order',
  newQuoteTitle: 'New quote',
  statDraft: 'Drafts',
  statSent: 'Awaiting quote',
  statReceived: 'Quoted',
  recentTitle: 'Recent quote orders',
  openOrders: 'Open Orders',
  emptyTitle: 'No quote orders yet',
  emptyBody:
    'A quote order sends a supplier the exact versions and outputs to quote. Earlier RFQs are listed here as quote orders.',
  suppliers: 'Suppliers',
  unavailableTitle: 'Orders are not available',
  unavailableBody: 'Quote orders live in Orders. Ask an administrator for access to the Orders module.',
}

const de: NamespaceDict = {
  subtitle: 'Angebotsanfragen und Lieferanten',
  newQuote: 'Neue Angebotsanfrage',
  newQuoteTitle: 'Neue Anfrage',
  statDraft: 'Entwürfe',
  statSent: 'Angebot ausstehend',
  statReceived: 'Angebot erhalten',
  recentTitle: 'Neueste Angebotsanfragen',
  openOrders: 'Aufträge öffnen',
  emptyTitle: 'Noch keine Angebotsanfragen',
  emptyBody:
    'Eine Angebotsanfrage schickt einem Lieferanten genau die Versionen und Ausgaben, die er anbieten soll. Frühere RFQs stehen hier als Angebotsanfragen.',
  suppliers: 'Lieferanten',
  unavailableTitle: 'Aufträge sind nicht verfügbar',
  unavailableBody:
    'Angebotsanfragen liegen unter Aufträge. Bitten Sie einen Administrator um Zugriff auf das Modul Aufträge.',
}

const es: NamespaceDict = {
  subtitle: 'Pedidos de presupuesto y proveedores',
  newQuote: 'Nuevo pedido de presupuesto',
  newQuoteTitle: 'Nuevo presupuesto',
  statDraft: 'Borradores',
  statSent: 'Esperando presupuesto',
  statReceived: 'Presupuestados',
  recentTitle: 'Pedidos de presupuesto recientes',
  openOrders: 'Abrir Pedidos',
  emptyTitle: 'Aún no hay pedidos de presupuesto',
  emptyBody:
    'Un pedido de presupuesto envía al proveedor las versiones y salidas exactas que debe presupuestar. Las RFQ anteriores aparecen aquí como pedidos de presupuesto.',
  suppliers: 'Proveedores',
  unavailableTitle: 'Pedidos no está disponible',
  unavailableBody:
    'Los pedidos de presupuesto están en Pedidos. Pida a un administrador acceso al módulo Pedidos.',
}

const fr: NamespaceDict = {
  subtitle: 'Demandes de devis et fournisseurs',
  newQuote: 'Nouvelle demande de devis',
  newQuoteTitle: 'Nouveau devis',
  statDraft: 'Brouillons',
  statSent: 'Devis attendu',
  statReceived: 'Devis reçu',
  recentTitle: 'Demandes de devis récentes',
  openOrders: 'Ouvrir Commandes',
  emptyTitle: 'Aucune demande de devis',
  emptyBody:
    'Une demande de devis envoie au fournisseur les versions et les sorties exactes à chiffrer. Les anciennes RFQ figurent ici comme demandes de devis.',
  suppliers: 'Fournisseurs',
  unavailableTitle: 'Commandes n’est pas disponible',
  unavailableBody:
    'Les demandes de devis se trouvent dans Commandes. Demandez à un administrateur l’accès au module Commandes.',
}

const pt: NamespaceDict = {
  subtitle: 'Pedidos de orçamento e fornecedores',
  newQuote: 'Novo pedido de orçamento',
  newQuoteTitle: 'Novo orçamento',
  statDraft: 'Rascunhos',
  statSent: 'Aguardando orçamento',
  statReceived: 'Orçados',
  recentTitle: 'Pedidos de orçamento recentes',
  openOrders: 'Abrir Encomendas',
  emptyTitle: 'Ainda não há pedidos de orçamento',
  emptyBody:
    'Um pedido de orçamento envia ao fornecedor as versões e saídas exatas a orçamentar. As RFQs anteriores aparecem aqui como pedidos de orçamento.',
  suppliers: 'Fornecedores',
  unavailableTitle: 'Encomendas não está disponível',
  unavailableBody:
    'Os pedidos de orçamento ficam em Encomendas. Peça a um administrador acesso ao módulo Encomendas.',
}

const zhCN: NamespaceDict = {
  subtitle: '询价订单和供应商',
  newQuote: '新建询价订单',
  newQuoteTitle: '新询价',
  statDraft: '草稿',
  statSent: '等待报价',
  statReceived: '已报价',
  recentTitle: '最近的询价订单',
  openOrders: '打开订单',
  emptyTitle: '还没有询价订单',
  emptyBody: '询价订单把供应商要报价的确切版本和输出发给对方。以前的 RFQ 在这里显示为询价订单。',
  suppliers: '供应商',
  unavailableTitle: '订单不可用',
  unavailableBody: '询价订单位于“订单”中。请向管理员申请“订单”模块的访问权限。',
}

const zhTW: NamespaceDict = {
  subtitle: '詢價訂單和供應商',
  newQuote: '新增詢價訂單',
  newQuoteTitle: '新詢價',
  statDraft: '草稿',
  statSent: '等待報價',
  statReceived: '已報價',
  recentTitle: '最近的詢價訂單',
  openOrders: '開啟訂單',
  emptyTitle: '還沒有詢價訂單',
  emptyBody: '詢價訂單把供應商要報價的確切版本和輸出發給對方。以前的 RFQ 在這裡顯示為詢價訂單。',
  suppliers: '供應商',
  unavailableTitle: '訂單無法使用',
  unavailableBody: '詢價訂單位於「訂單」中。請向管理員申請「訂單」模組的存取權限。',
}

export const supplierPortalStrings = { en, de, es, fr, pt, zhCN, zhTW }
