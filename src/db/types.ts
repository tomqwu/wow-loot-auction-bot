export type AuctionStatus = 'active' | 'closed' | 'cancelled';
export type SettlementStatus = 'unpaid' | 'paid' | 'traded' | 'cancelled';

export interface UserRow {
  discord_user_id: string;
  character_name: string;
  realm: string;
  created_at: number;
  updated_at: number;
}

export interface ItemRow {
  id: number;
  game_version: string;
  item_id: number | null;
  item_name: string;
  raw_item_link: string | null;
  wowhead_url: string | null;
}

export interface AuctionRow {
  id: number;
  item_id_ref: number;
  channel_id: string;
  message_id: string | null;
  status: AuctionStatus;
  start_price: number;
  min_increment: number;
  current_price: number;
  winner_user_id: string | null;
  ends_at: number;
  created_by: string;
  created_at: number;
  closed_at: number | null;
}

export interface BidRow {
  id: number;
  auction_id: number;
  user_id: string;
  amount: number;
  voided: number;
  void_reason: string | null;
  created_at: number;
}

export interface SettlementRow {
  id: number;
  auction_id: number;
  status: SettlementStatus;
  updated_by: string;
  updated_at: number;
}

export interface AuditLogRow {
  id: number;
  action: string;
  actor_user_id: string;
  auction_id: number | null;
  payload_json: string | null;
  created_at: number;
}
