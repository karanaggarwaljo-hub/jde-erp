/**
 * Which GST a sale is charged, from where it is made and where it is supplied to. Pure; used by the
 * bill form (what it shows while billing) and the tax invoice (what it prints), so both say the
 * same.
 *
 *   inter-state (place of supply in another state or UT)   IGST
 *   intra-state, in a state or a UT with a legislature     CGST + SGST   (Delhi, Puducherry, J&K)
 *   intra-state, in a UT without a legislature             CGST + UTGST  (Chandigarh, Ladakh,
 *                                                         Lakshadweep, Andaman and Nicobar,
 *                                                         Dadra and Nagar Haveli and Daman and Diu)
 *
 * The place of supply is the one chosen on the bill; failing that, the state in the buyer's GSTIN;
 * failing that (a counter sale), the seller's own state.
 */

/** GST state codes (the first two digits of a GSTIN) and their names. */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland',
  '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '25': 'Daman and Diu', '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
};

/** Union Territories without a legislature, where the state half of GST is UTGST. */
export const UTGST_CODES = new Set(['04', '25', '26', '31', '35', '38', '97']);

/** The states and UTs to choose a place of supply from, by name. */
export const PLACE_OF_SUPPLY_OPTIONS: Array<{ code: string; name: string }> = Object.entries(GST_STATES)
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** The state code at the start of a GSTIN, or '' when it is not a GSTIN. */
export function stateCodeOfGstin(gstin: string | null | undefined): string {
  const value = String(gstin ?? '').trim().toUpperCase();
  return /^\d{2}[A-Z0-9]{13}$/.test(value) && GST_STATES[value.slice(0, 2)] ? value.slice(0, 2) : '';
}

export function isStateCode(value: unknown): value is string {
  return typeof value === 'string' && Boolean(GST_STATES[value]);
}

export type SupplyTax = {
  /** Where the goods are supplied to: its code and name ('' when nothing says). */
  placeCode: string;
  placeName: string;
  kind: 'intra' | 'inter' | 'unknown';
  /** The state half of an intra-state sale: SGST, or UTGST in a UT without a legislature. */
  localTax: 'SGST' | 'UTGST';
  /** The name of that half in a tax summary column. */
  localTaxColumn: 'State Tax' | 'UT Tax';
};

/** What a sale from `sellerGstin` to a buyer with `buyerGstin` is charged, with `chosenPlace` (a
 *  state code picked on the bill) taking precedence over the buyer's GSTIN. With no seller GSTIN
 *  there is nothing to compare against, so the kind is unknown. */
export function supplyTax(sellerGstin: string | null | undefined, buyerGstin: string | null | undefined, chosenPlace?: string | null): SupplyTax {
  const sellerCode = stateCodeOfGstin(sellerGstin);
  const placeCode = isStateCode(chosenPlace) ? chosenPlace : stateCodeOfGstin(buyerGstin) || sellerCode;
  const kind = sellerCode && placeCode ? (sellerCode === placeCode ? 'intra' : 'inter') : 'unknown';
  const ut = UTGST_CODES.has(sellerCode);
  return {
    placeCode,
    placeName: GST_STATES[placeCode] ?? '',
    kind,
    localTax: ut ? 'UTGST' : 'SGST',
    localTaxColumn: ut ? 'UT Tax' : 'State Tax',
  };
}
