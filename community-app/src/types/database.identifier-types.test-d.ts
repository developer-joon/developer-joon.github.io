import type { Database } from "./database";

type ExpectedIdentifierType =
  | "legacy_company_id"
  | "opendart_corp_code"
  | "business_number_hmac_v1";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

type IdentifierTable = Database["public"]["Tables"]["benefit_company_identifiers"];

type RowIdentifierTypeIsExact = Assert<Equal<IdentifierTable["Row"]["identifier_type"], ExpectedIdentifierType>>;
type InsertIdentifierTypeIsExact = Assert<Equal<IdentifierTable["Insert"]["identifier_type"], ExpectedIdentifierType>>;
type UpdateIdentifierTypeIsExact = Assert<
  Equal<IdentifierTable["Update"]["identifier_type"], ExpectedIdentifierType | undefined>
>;

export type IdentifierTypeContract = [
  RowIdentifierTypeIsExact,
  InsertIdentifierTypeIsExact,
  UpdateIdentifierTypeIsExact,
];