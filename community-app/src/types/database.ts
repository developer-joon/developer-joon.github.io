
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {

  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "attachments": {
                  Row: {
                    "attached_at": string | null,"byte_size": number,"cleanup_attempt_count": number,"cleanup_claim_token": string | null,"cleanup_last_error": string | null,"cleanup_lease_until": string | null,"client_key": string | null,"created_at": string,"deleted_at": string | null,"id": string,"mime_type": string,"next_attempt_at": string | null,"owner_id": string,"payload_sha256": string | null,"post_id": string | null,"status": string,"storage_path": string
                  }
                  Insert: {
                    "attached_at"?: string | null,"byte_size": number,"cleanup_attempt_count"?: number,"cleanup_claim_token"?: string | null,"cleanup_last_error"?: string | null,"cleanup_lease_until"?: string | null,"client_key"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"mime_type": string,"next_attempt_at"?: string | null,"owner_id": string,"payload_sha256"?: string | null,"post_id"?: string | null,"status"?: string,"storage_path": string
                  }
                  Update: {
                    "attached_at"?: string | null,"byte_size"?: number,"cleanup_attempt_count"?: number,"cleanup_claim_token"?: string | null,"cleanup_last_error"?: string | null,"cleanup_lease_until"?: string | null,"client_key"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"mime_type"?: string,"next_attempt_at"?: string | null,"owner_id"?: string,"payload_sha256"?: string | null,"post_id"?: string | null,"status"?: string,"storage_path"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "attachments_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attachments_post_id_fkey"
      columns: ["post_id"]
isOneToOne: false
      referencedRelation: "posts"
      referencedColumns: ["id"]
    }
                  ]
                },"comment_reactions": {
                  Row: {
                    "comment_id": string,"created_at": string,"id": string,"user_id": string
                  }
                  Insert: {
                    "comment_id": string,"created_at"?: string,"id"?: string,"user_id": string
                  }
                  Update: {
                    "comment_id"?: string,"created_at"?: string,"id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "comment_reactions_comment_id_fkey"
      columns: ["comment_id"]
isOneToOne: false
      referencedRelation: "comments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comment_reactions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"comments": {
                  Row: {
                    "author_id": string,"body_markdown": string,"created_at": string,"deleted_at": string | null,"id": string,"parent_id": string | null,"post_id": string,"status": string,"updated_at": string
                  }
                  Insert: {
                    "author_id": string,"body_markdown": string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"parent_id"?: string | null,"post_id": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "author_id"?: string,"body_markdown"?: string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"parent_id"?: string | null,"post_id"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "comments_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comments_parent_id_post_id_fkey"
      columns: ["parent_id","post_id"]
isOneToOne: false
      referencedRelation: "comments"
      referencedColumns: ["id","post_id"]
    },{
      foreignKeyName: "comments_post_id_fkey"
      columns: ["post_id"]
isOneToOne: false
      referencedRelation: "posts"
      referencedColumns: ["id"]
    }
                  ]
                },"idempotency_keys": {
                  Row: {
                    "created_at": string,"expires_at": string,"id": string,"key": string,"operation": string,"request_hash": string,"resource_id": string | null,"resource_type": string | null,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"expires_at": string,"id"?: string,"key": string,"operation": string,"request_hash": string,"resource_id"?: string | null,"resource_type"?: string | null,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"expires_at"?: string,"id"?: string,"key"?: string,"operation"?: string,"request_hash"?: string,"resource_id"?: string | null,"resource_type"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "idempotency_keys_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"moderation_audit_logs": {
                  Row: {
                    "action": string,"actor_id": string | null,"created_at": string,"id": string,"metadata": NonNullable<Json>,"reason": string | null,"target_id": string,"target_type": string
                  }
                  Insert: {
                    "action": string,"actor_id"?: string | null,"created_at"?: string,"id"?: string,"metadata"?: NonNullable<Json>,"reason"?: string | null,"target_id": string,"target_type": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"created_at"?: string,"id"?: string,"metadata"?: NonNullable<Json>,"reason"?: string | null,"target_id"?: string,"target_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "moderation_audit_logs_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"post_reactions": {
                  Row: {
                    "created_at": string,"id": string,"post_id": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"post_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"post_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "post_reactions_post_id_fkey"
      columns: ["post_id"]
isOneToOne: false
      referencedRelation: "posts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "post_reactions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"post_tags": {
                  Row: {
                    "post_id": string,"tag_id": string
                  }
                  Insert: {
                    "post_id": string,"tag_id": string
                  }
                  Update: {
                    "post_id"?: string,"tag_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "post_tags_post_id_fkey"
      columns: ["post_id"]
isOneToOne: false
      referencedRelation: "posts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "post_tags_tag_id_fkey"
      columns: ["tag_id"]
isOneToOne: false
      referencedRelation: "tags"
      referencedColumns: ["id"]
    }
                  ]
                },"posts": {
                  Row: {
                    "author_id": string,"body_markdown": string,"created_at": string,"deleted_at": string | null,"id": string,"is_locked": boolean,"is_pinned": boolean,"status": string,"title": string,"updated_at": string
                  }
                  Insert: {
                    "author_id": string,"body_markdown": string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"is_locked"?: boolean,"is_pinned"?: boolean,"status"?: string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "author_id"?: string,"body_markdown"?: string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"is_locked"?: boolean,"is_pinned"?: boolean,"status"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "posts_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"display_name": string | null,"github_user_id": number,"id": string,"login": string,"updated_at": string
                  }
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_name"?: string | null,"github_user_id": number,"id": string,"login": string,"updated_at"?: string
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_name"?: string | null,"github_user_id"?: number,"id"?: string,"login"?: string,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                },"rate_limit_events": {
                  Row: {
                    "action": string,"id": string,"idempotency_key": string | null,"occurred_at": string,"upload_reservation_id": string | null,"user_id": string
                  }
                  Insert: {
                    "action": string,"id"?: string,"idempotency_key"?: string | null,"occurred_at"?: string,"upload_reservation_id"?: string | null,"user_id": string
                  }
                  Update: {
                    "action"?: string,"id"?: string,"idempotency_key"?: string | null,"occurred_at"?: string,"upload_reservation_id"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "rate_limit_events_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"rate_limit_rules": {
                  Row: {
                    "action": string,"created_at": string,"id": string,"is_enabled": boolean,"max_requests": number,"updated_at": string,"window_seconds": number
                  }
                  Insert: {
                    "action": string,"created_at"?: string,"id"?: string,"is_enabled"?: boolean,"max_requests": number,"updated_at"?: string,"window_seconds": number
                  }
                  Update: {
                    "action"?: string,"created_at"?: string,"id"?: string,"is_enabled"?: boolean,"max_requests"?: number,"updated_at"?: string,"window_seconds"?: number
                  }
                  Relationships: [

                  ]
                },"reports": {
                  Row: {
                    "created_at": string,"detail": string | null,"id": string,"reason_code": string,"reporter_id": string,"resolved_at": string | null,"resolved_by": string | null,"status": string,"target_id": string,"target_type": string
                  }
                  Insert: {
                    "created_at"?: string,"detail"?: string | null,"id"?: string,"reason_code": string,"reporter_id": string,"resolved_at"?: string | null,"resolved_by"?: string | null,"status"?: string,"target_id": string,"target_type": string
                  }
                  Update: {
                    "created_at"?: string,"detail"?: string | null,"id"?: string,"reason_code"?: string,"reporter_id"?: string,"resolved_at"?: string | null,"resolved_by"?: string | null,"status"?: string,"target_id"?: string,"target_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reports_reporter_id_fkey"
      columns: ["reporter_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_resolved_by_fkey"
      columns: ["resolved_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"tags": {
                  Row: {
                    "id": string,"is_active": boolean,"label": string,"slug": string,"sort_order": number
                  }
                  Insert: {
                    "id"?: string,"is_active"?: boolean,"label": string,"slug": string,"sort_order"?: number
                  }
                  Update: {
                    "id"?: string,"is_active"?: boolean,"label"?: string,"slug"?: string,"sort_order"?: number
                  }
                  Relationships: [

                  ]
                },"user_roles": {
                  Row: {
                    "granted_at": string,"granted_by": string | null,"role": string,"user_id": string
                  }
                  Insert: {
                    "granted_at"?: string,"granted_by"?: string | null,"role"?: string,"user_id": string
                  }
                  Update: {
                    "granted_at"?: string,"granted_by"?: string | null,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_roles_granted_by_fkey"
      columns: ["granted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "user_roles_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "attach_attachments":
{ Args: { "p_attachment_ids": (string)[],"p_post_id": string }; Returns: number
                           },
"claim_attachment_cleanup":
{ Args: { "p_limit"?: number }; Returns: {
              "claim_token": string,"id": string,"storage_path": string
            }[]
                           },
"complete_attachment_cleanup":
{ Args: { "p_attachment_id": string,"p_claim_token": string,"p_storage_path": string }; Returns: boolean
                           },
"create_attachment_upload_intent":
{ Args: { "p_byte_size": number,"p_content_hash": string,"p_idempotency_key": string,"p_mime_type": string }; Returns: Database["public"]['CompositeTypes']["attachment_upload_intent"]
                          SetofOptions: {
        from: "*"
        to: "attachment_upload_intent"
        isOneToOne: true
        isSetofReturn: false
      } },
"create_comment":
{ Args: { "p_body_markdown": string,"p_idempotency_key": string,"p_parent_id": string,"p_post_id": string }; Returns: string
                           },
"create_post":
{ Args: { "p_body_markdown": string,"p_idempotency_key": string,"p_tag_ids": (string)[],"p_title": string }; Returns: string
                           },
"create_report":
{ Args: { "p_detail": string,"p_idempotency_key": string,"p_reason_code": string,"p_target_id": string,"p_target_type": string }; Returns: string
                           },
"fail_attachment_upload":
{ Args: { "p_attachment_id": string,"p_storage_path": string }; Returns: boolean
                           },
"get_public_post":
{ Args: { "p_post_id": string }; Returns: {
              "author_avatar_url": string,"author_display_name": string,"author_id": string,"author_login": string,"body_markdown": string,"comment_count": number,"created_at": string,"id": string,"is_locked": boolean,"is_pinned": boolean,"popularity_score": number,"reaction_count": number,"tags": Json,"title": string,"updated_at": string
            }[]
                           },
"get_public_post_v2":
{ Args: { "p_post_id": string }; Returns: Json
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"list_public_post_comments":
{ Args: { "p_post_id": string }; Returns: {
              "author_avatar_url": string,"author_display_name": string,"author_id": string,"author_login": string,"body_markdown": string,"created_at": string,"id": string,"parent_id": string,"row_number": number,"updated_at": string
            }[]
                           },
"list_public_posts":
{ Args: { "p_cursor_created_at"?: string,"p_cursor_id"?: string,"p_cursor_is_pinned"?: boolean,"p_cursor_rank"?: number,"p_cursor_search_rank"?: number,"p_limit": number,"p_search"?: string,"p_sort": string,"p_tag_id"?: string }; Returns: {
              "author_avatar_url": string,"author_display_name": string,"author_id": string,"author_login": string,"comment_count": number,"created_at": string,"excerpt": string,"id": string,"is_locked": boolean,"is_pinned": boolean,"popularity_score": number,"rank_key": number,"reaction_count": number,"row_number": number,"search_rank": number,"tags": Json,"title": string,"updated_at": string
            }[]
                           },
"prepare_attachment_cleanup":
{ Args: { "p_attachment_id": string,"p_claim_token": string,"p_storage_path": string }; Returns: boolean
                           },
"refund_attachment_upload_replay":
{ Args: { "p_byte_size": number,"p_content_hash": string,"p_idempotency_key": string,"p_mime_type": string,"p_reservation_id": string }; Returns: boolean
                           },
"release_attachment_cleanup":
{ Args: { "p_attachment_id": string,"p_claim_token": string,"p_reason": string,"p_storage_path": string }; Returns: boolean
                           },
"reserve_attachment_upload":
{ Args: { "p_idempotency_key": string }; Returns: string
                           },
"resolve_public_attachment":
{ Args: { "p_attachment_id": string }; Returns: {
              "attachment_id": string,"byte_size": number,"mime_type": string,"object_token": string,"owner_id": string,"storage_path": string
            }[]
                           },
"soft_delete_comment":
{ Args: { "p_comment_id": string }; Returns: string
                           },
"soft_delete_post":
{ Args: { "p_post_id": string }; Returns: string
                           },
"toggle_comment_reaction":
{ Args: { "p_comment_id": string }; Returns: boolean
                           },
"toggle_post_reaction":
{ Args: { "p_post_id": string }; Returns: boolean
                           },
"update_comment":
{ Args: { "p_body_markdown": string,"p_comment_id": string }; Returns: string
                           },
"update_post":
{ Args: { "p_body_markdown": string,"p_post_id": string,"p_tag_ids": (string)[],"p_title": string }; Returns: string
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            "attachment_upload_intent": {
                        "id": string | null,"storage_path": string | null,"is_replay": boolean | null,"object_exists": boolean | null
                      }
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {

          }
        },"public": {
          Enums: {

          }
        }
} as const
