export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          details: NonNullable<Json>;
          id: string;
          project_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          details?: NonNullable<Json>;
          id?: string;
          project_id?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          details?: NonNullable<Json>;
          id?: string;
          project_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_log_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audit_log_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audit_log_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects_public';
            referencedColumns: ['id'];
          },
        ];
      };
      comparison_items: {
        Row: {
          after_dims: number[] | null;
          after_key: string | null;
          before_dims: number[] | null;
          before_key: string | null;
          comparison_id: string;
          created_at: string;
          diff_key: string | null;
          diff_pct: number | null;
          diff_pixels: number | null;
          error: string | null;
          fp_after: Json | null;
          fp_before: Json | null;
          id: string;
          kind: Database['public']['Enums']['item_kind'];
          name: string;
          redirect_to: string | null;
          review: Database['public']['Enums']['review_status'];
          review_note: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: Database['public']['Enums']['cmp_item_status'];
          total_pixels: number | null;
          url: string | null;
          viewport_slug: string | null;
        };
        ComputedFields: never;
        Insert: {
          after_dims?: number[] | null;
          after_key?: string | null;
          before_dims?: number[] | null;
          before_key?: string | null;
          comparison_id: string;
          created_at?: string;
          diff_key?: string | null;
          diff_pct?: number | null;
          diff_pixels?: number | null;
          error?: string | null;
          fp_after?: Json | null;
          fp_before?: Json | null;
          id?: string;
          kind: Database['public']['Enums']['item_kind'];
          name: string;
          redirect_to?: string | null;
          review?: Database['public']['Enums']['review_status'];
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database['public']['Enums']['cmp_item_status'];
          total_pixels?: number | null;
          url?: string | null;
          viewport_slug?: string | null;
        };
        Update: {
          after_dims?: number[] | null;
          after_key?: string | null;
          before_dims?: number[] | null;
          before_key?: string | null;
          comparison_id?: string;
          created_at?: string;
          diff_key?: string | null;
          diff_pct?: number | null;
          diff_pixels?: number | null;
          error?: string | null;
          fp_after?: Json | null;
          fp_before?: Json | null;
          id?: string;
          kind?: Database['public']['Enums']['item_kind'];
          name?: string;
          redirect_to?: string | null;
          review?: Database['public']['Enums']['review_status'];
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database['public']['Enums']['cmp_item_status'];
          total_pixels?: number | null;
          url?: string | null;
          viewport_slug?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'comparison_items_comparison_id_fkey';
            columns: ['comparison_id'];
            isOneToOne: false;
            referencedRelation: 'comparisons';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'comparison_items_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      comparisons: {
        Row: {
          after_run_id: string;
          before_run_id: string;
          counts: NonNullable<Json>;
          created_at: string;
          finished_at: string | null;
          id: string;
          label: string;
          project_id: string;
          report_r2_key: string | null;
          review_counts: NonNullable<Json>;
          settings: NonNullable<Json>;
          share_expires_at: string | null;
          share_token_hash: string | null;
          started_at: string | null;
          started_by: string | null;
          status: Database['public']['Enums']['comparison_status'];
          workflow_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          after_run_id: string;
          before_run_id: string;
          counts?: NonNullable<Json>;
          created_at?: string;
          finished_at?: string | null;
          id?: string;
          label: string;
          project_id: string;
          report_r2_key?: string | null;
          review_counts?: NonNullable<Json>;
          settings?: NonNullable<Json>;
          share_expires_at?: string | null;
          share_token_hash?: string | null;
          started_at?: string | null;
          started_by?: string | null;
          status?: Database['public']['Enums']['comparison_status'];
          workflow_id?: string | null;
        };
        Update: {
          after_run_id?: string;
          before_run_id?: string;
          counts?: NonNullable<Json>;
          created_at?: string;
          finished_at?: string | null;
          id?: string;
          label?: string;
          project_id?: string;
          report_r2_key?: string | null;
          review_counts?: NonNullable<Json>;
          settings?: NonNullable<Json>;
          share_expires_at?: string | null;
          share_token_hash?: string | null;
          started_at?: string | null;
          started_by?: string | null;
          status?: Database['public']['Enums']['comparison_status'];
          workflow_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'comparisons_project_id_after_run_id_fkey';
            columns: ['project_id', 'after_run_id'];
            isOneToOne: false;
            referencedRelation: 'runs';
            referencedColumns: ['project_id', 'id'];
          },
          {
            foreignKeyName: 'comparisons_project_id_before_run_id_fkey';
            columns: ['project_id', 'before_run_id'];
            isOneToOne: false;
            referencedRelation: 'runs';
            referencedColumns: ['project_id', 'id'];
          },
          {
            foreignKeyName: 'comparisons_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'comparisons_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects_public';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'comparisons_started_by_fkey';
            columns: ['started_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      ignore_rules: {
        Row: {
          applies_to: string;
          created_at: string;
          created_by: string | null;
          enabled: boolean;
          id: string;
          project_id: string;
          reason: string | null;
          region: Json | null;
          selector: string | null;
          type: Database['public']['Enums']['ignore_rule_type'];
          url_pattern: string | null;
          viewport_slug: string | null;
        };
        ComputedFields: never;
        Insert: {
          applies_to?: string;
          created_at?: string;
          created_by?: string | null;
          enabled?: boolean;
          id?: string;
          project_id: string;
          reason?: string | null;
          region?: Json | null;
          selector?: string | null;
          type: Database['public']['Enums']['ignore_rule_type'];
          url_pattern?: string | null;
          viewport_slug?: string | null;
        };
        Update: {
          applies_to?: string;
          created_at?: string;
          created_by?: string | null;
          enabled?: boolean;
          id?: string;
          project_id?: string;
          reason?: string | null;
          region?: Json | null;
          selector?: string | null;
          type?: Database['public']['Enums']['ignore_rule_type'];
          url_pattern?: string | null;
          viewport_slug?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'ignore_rules_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ignore_rules_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ignore_rules_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects_public';
            referencedColumns: ['id'];
          },
        ];
      };
      invitations: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string | null;
          project_id: string | null;
          role: Database['public']['Enums']['project_role'] | null;
          token_hash: string | null;
        };
        ComputedFields: never;
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          email: string;
          expires_at?: string;
          id?: string;
          invited_by?: string | null;
          project_id?: string | null;
          role?: Database['public']['Enums']['project_role'] | null;
          token_hash?: string | null;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string | null;
          project_id?: string | null;
          role?: Database['public']['Enums']['project_role'] | null;
          token_hash?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'invitations_invited_by_fkey';
            columns: ['invited_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invitations_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invitations_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects_public';
            referencedColumns: ['id'];
          },
        ];
      };
      notification_channels: {
        Row: {
          created_at: string;
          enabled: boolean;
          events: string[];
          id: string;
          project_id: string;
          target: string | null;
          target_enc: string | null;
          type: Database['public']['Enums']['channel_type'];
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          enabled?: boolean;
          events?: string[];
          id?: string;
          project_id: string;
          target?: string | null;
          target_enc?: string | null;
          type: Database['public']['Enums']['channel_type'];
        };
        Update: {
          created_at?: string;
          enabled?: boolean;
          events?: string[];
          id?: string;
          project_id?: string;
          target?: string | null;
          target_enc?: string | null;
          type?: Database['public']['Enums']['channel_type'];
        };
        Relationships: [
          {
            foreignKeyName: 'notification_channels_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notification_channels_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects_public';
            referencedColumns: ['id'];
          },
        ];
      };
      notification_log: {
        Row: {
          channel_id: string;
          created_at: string;
          entity_id: string | null;
          error: string | null;
          event: string;
          id: string;
          sent_at: string | null;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          channel_id: string;
          created_at?: string;
          entity_id?: string | null;
          error?: string | null;
          event: string;
          id?: string;
          sent_at?: string | null;
          status: string;
        };
        Update: {
          channel_id?: string;
          created_at?: string;
          entity_id?: string | null;
          error?: string | null;
          event?: string;
          id?: string;
          sent_at?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notification_log_channel_id_fkey';
            columns: ['channel_id'];
            isOneToOne: false;
            referencedRelation: 'notification_channels';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          disabled_at: string | null;
          email: string;
          full_name: string | null;
          id: string;
          is_platform_admin: boolean;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          disabled_at?: string | null;
          email: string;
          full_name?: string | null;
          id: string;
          is_platform_admin?: boolean;
        };
        Update: {
          created_at?: string;
          disabled_at?: string | null;
          email?: string;
          full_name?: string | null;
          id?: string;
          is_platform_admin?: boolean;
        };
        Relationships: [];
      };
      project_manual_urls: {
        Row: {
          created_at: string;
          id: string;
          note: string | null;
          project_id: string;
          url: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          note?: string | null;
          project_id: string;
          url: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          note?: string | null;
          project_id?: string;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'project_manual_urls_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'project_manual_urls_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects_public';
            referencedColumns: ['id'];
          },
        ];
      };
      project_members: {
        Row: {
          created_at: string;
          project_id: string;
          role: Database['public']['Enums']['project_role'];
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          project_id: string;
          role: Database['public']['Enums']['project_role'];
          user_id: string;
        };
        Update: {
          created_at?: string;
          project_id?: string;
          role?: Database['public']['Enums']['project_role'];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'project_members_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'project_members_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects_public';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'project_members_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      projects: {
        Row: {
          archived_at: string | null;
          baseline_run_id: string | null;
          basic_auth_pass_enc: string | null;
          basic_auth_user: string | null;
          capture_concurrency: number;
          change_threshold_pct: number;
          check_redirects: boolean;
          created_at: string;
          created_by: string | null;
          diff_threshold: number;
          extra_css: string | null;
          file_extensions: string[] | null;
          hide_selectors: string[];
          id: string;
          max_page_height: number;
          name: string;
          notes: string | null;
          page_timeout_ms: number;
          r2_bucket: string;
          r2_public_url: string | null;
          settle_ms: number;
          sitemap_index: string;
          slug: string;
        };
        ComputedFields: never;
        Insert: {
          archived_at?: string | null;
          baseline_run_id?: string | null;
          basic_auth_pass_enc?: string | null;
          basic_auth_user?: string | null;
          capture_concurrency?: number;
          change_threshold_pct?: number;
          check_redirects?: boolean;
          created_at?: string;
          created_by?: string | null;
          diff_threshold?: number;
          extra_css?: string | null;
          file_extensions?: string[] | null;
          hide_selectors?: string[];
          id?: string;
          max_page_height?: number;
          name: string;
          notes?: string | null;
          page_timeout_ms?: number;
          r2_bucket: string;
          r2_public_url?: string | null;
          settle_ms?: number;
          sitemap_index: string;
          slug: string;
        };
        Update: {
          archived_at?: string | null;
          baseline_run_id?: string | null;
          basic_auth_pass_enc?: string | null;
          basic_auth_user?: string | null;
          capture_concurrency?: number;
          change_threshold_pct?: number;
          check_redirects?: boolean;
          created_at?: string;
          created_by?: string | null;
          diff_threshold?: number;
          extra_css?: string | null;
          file_extensions?: string[] | null;
          hide_selectors?: string[];
          id?: string;
          max_page_height?: number;
          name?: string;
          notes?: string | null;
          page_timeout_ms?: number;
          r2_bucket?: string;
          r2_public_url?: string | null;
          settle_ms?: number;
          sitemap_index?: string;
          slug?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'projects_baseline_run_id_fkey';
            columns: ['id', 'baseline_run_id'];
            isOneToOne: false;
            referencedRelation: 'runs';
            referencedColumns: ['project_id', 'id'];
          },
          {
            foreignKeyName: 'projects_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      review_memory: {
        Row: {
          after_sha256: string;
          created_at: string;
          decided_by: string | null;
          id: string;
          project_id: string;
          review: Database['public']['Enums']['review_status'];
          url: string;
          viewport_slug: string | null;
        };
        ComputedFields: never;
        Insert: {
          after_sha256: string;
          created_at?: string;
          decided_by?: string | null;
          id?: string;
          project_id: string;
          review: Database['public']['Enums']['review_status'];
          url: string;
          viewport_slug?: string | null;
        };
        Update: {
          after_sha256?: string;
          created_at?: string;
          decided_by?: string | null;
          id?: string;
          project_id?: string;
          review?: Database['public']['Enums']['review_status'];
          url?: string;
          viewport_slug?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'review_memory_decided_by_fkey';
            columns: ['decided_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'review_memory_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'review_memory_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects_public';
            referencedColumns: ['id'];
          },
        ];
      };
      run_items: {
        Row: {
          attempts: number;
          bytes: number | null;
          content_type: string | null;
          created_at: string;
          error: string | null;
          etag: string | null;
          filename: string;
          final_url: string | null;
          finished_at: string | null;
          height: number | null;
          http_status: number | null;
          id: string;
          kind: Database['public']['Enums']['item_kind'];
          last_modified: string | null;
          r2_key: string | null;
          run_id: string;
          sha256: string | null;
          status: Database['public']['Enums']['item_status'];
          truncated: boolean;
          url: string | null;
          viewport_slug: string | null;
          width: number | null;
        };
        ComputedFields: never;
        Insert: {
          attempts?: number;
          bytes?: number | null;
          content_type?: string | null;
          created_at?: string;
          error?: string | null;
          etag?: string | null;
          filename: string;
          final_url?: string | null;
          finished_at?: string | null;
          height?: number | null;
          http_status?: number | null;
          id?: string;
          kind: Database['public']['Enums']['item_kind'];
          last_modified?: string | null;
          r2_key?: string | null;
          run_id: string;
          sha256?: string | null;
          status?: Database['public']['Enums']['item_status'];
          truncated?: boolean;
          url?: string | null;
          viewport_slug?: string | null;
          width?: number | null;
        };
        Update: {
          attempts?: number;
          bytes?: number | null;
          content_type?: string | null;
          created_at?: string;
          error?: string | null;
          etag?: string | null;
          filename?: string;
          final_url?: string | null;
          finished_at?: string | null;
          height?: number | null;
          http_status?: number | null;
          id?: string;
          kind?: Database['public']['Enums']['item_kind'];
          last_modified?: string | null;
          r2_key?: string | null;
          run_id?: string;
          sha256?: string | null;
          status?: Database['public']['Enums']['item_status'];
          truncated?: boolean;
          url?: string | null;
          viewport_slug?: string | null;
          width?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'run_items_run_id_fkey';
            columns: ['run_id'];
            isOneToOne: false;
            referencedRelation: 'runs';
            referencedColumns: ['id'];
          },
        ];
      };
      runs: {
        Row: {
          cancel_requested_at: string | null;
          created_at: string;
          done_items: number;
          failed_items: number;
          finished_at: string | null;
          id: string;
          is_legacy: boolean;
          label: string;
          note: string | null;
          project_id: string;
          settings: NonNullable<Json>;
          snapshot_id: string | null;
          started_at: string | null;
          started_by: string | null;
          status: Database['public']['Enums']['run_status'];
          total_items: number;
          viewport_slugs: string[];
          workflow_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          cancel_requested_at?: string | null;
          created_at?: string;
          done_items?: number;
          failed_items?: number;
          finished_at?: string | null;
          id?: string;
          is_legacy?: boolean;
          label: string;
          note?: string | null;
          project_id: string;
          settings?: NonNullable<Json>;
          snapshot_id?: string | null;
          started_at?: string | null;
          started_by?: string | null;
          status?: Database['public']['Enums']['run_status'];
          total_items?: number;
          viewport_slugs?: string[];
          workflow_id?: string | null;
        };
        Update: {
          cancel_requested_at?: string | null;
          created_at?: string;
          done_items?: number;
          failed_items?: number;
          finished_at?: string | null;
          id?: string;
          is_legacy?: boolean;
          label?: string;
          note?: string | null;
          project_id?: string;
          settings?: NonNullable<Json>;
          snapshot_id?: string | null;
          started_at?: string | null;
          started_by?: string | null;
          status?: Database['public']['Enums']['run_status'];
          total_items?: number;
          viewport_slugs?: string[];
          workflow_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'runs_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'runs_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects_public';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'runs_snapshot_id_fkey';
            columns: ['snapshot_id'];
            isOneToOne: false;
            referencedRelation: 'sitemap_snapshots';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'runs_started_by_fkey';
            columns: ['started_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      sitemap_snapshots: {
        Row: {
          child_sitemaps: number;
          created_at: string;
          error: string | null;
          error_count: number;
          finished_at: string | null;
          id: string;
          project_id: string;
          redirect_count: number;
          source_url: string;
          started_by: string | null;
          status: string;
          url_count: number;
          urls_checked: number;
          urls_total: number;
        };
        ComputedFields: never;
        Insert: {
          child_sitemaps?: number;
          created_at?: string;
          error?: string | null;
          error_count?: number;
          finished_at?: string | null;
          id?: string;
          project_id: string;
          redirect_count?: number;
          source_url: string;
          started_by?: string | null;
          status?: string;
          url_count?: number;
          urls_checked?: number;
          urls_total?: number;
        };
        Update: {
          child_sitemaps?: number;
          created_at?: string;
          error?: string | null;
          error_count?: number;
          finished_at?: string | null;
          id?: string;
          project_id?: string;
          redirect_count?: number;
          source_url?: string;
          started_by?: string | null;
          status?: string;
          url_count?: number;
          urls_checked?: number;
          urls_total?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'sitemap_snapshots_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sitemap_snapshots_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects_public';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sitemap_snapshots_started_by_fkey';
            columns: ['started_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      sitemap_urls: {
        Row: {
          created_at: string;
          http_status: number | null;
          id: string;
          included: boolean;
          kind: Database['public']['Enums']['item_kind'];
          redirect_to: string | null;
          snapshot_id: string;
          source: string;
          url: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          http_status?: number | null;
          id?: string;
          included?: boolean;
          kind: Database['public']['Enums']['item_kind'];
          redirect_to?: string | null;
          snapshot_id: string;
          source?: string;
          url: string;
        };
        Update: {
          created_at?: string;
          http_status?: number | null;
          id?: string;
          included?: boolean;
          kind?: Database['public']['Enums']['item_kind'];
          redirect_to?: string | null;
          snapshot_id?: string;
          source?: string;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'sitemap_urls_snapshot_id_fkey';
            columns: ['snapshot_id'];
            isOneToOne: false;
            referencedRelation: 'sitemap_snapshots';
            referencedColumns: ['id'];
          },
        ];
      };
      storage_usage: {
        Row: {
          bucket: string;
          error: string | null;
          groups: NonNullable<Json>;
          object_count: number;
          project_id: string;
          refreshed_at: string | null;
          status: string;
          total_bytes: number;
          updated_at: string;
          workflow_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          bucket: string;
          error?: string | null;
          groups?: NonNullable<Json>;
          object_count?: number;
          project_id: string;
          refreshed_at?: string | null;
          status?: string;
          total_bytes?: number;
          updated_at?: string;
          workflow_id?: string | null;
        };
        Update: {
          bucket?: string;
          error?: string | null;
          groups?: NonNullable<Json>;
          object_count?: number;
          project_id?: string;
          refreshed_at?: string | null;
          status?: string;
          total_bytes?: number;
          updated_at?: string;
          workflow_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'storage_usage_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: true;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'storage_usage_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: true;
            referencedRelation: 'projects_public';
            referencedColumns: ['id'];
          },
        ];
      };
      viewports: {
        Row: {
          created_at: string;
          device_scale_factor: number;
          enabled: boolean;
          height: number;
          id: string;
          is_mobile: boolean;
          project_id: string;
          slug: string;
          sort_order: number;
          width: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          device_scale_factor?: number;
          enabled?: boolean;
          height?: number;
          id?: string;
          is_mobile?: boolean;
          project_id: string;
          slug: string;
          sort_order?: number;
          width?: number;
        };
        Update: {
          created_at?: string;
          device_scale_factor?: number;
          enabled?: boolean;
          height?: number;
          id?: string;
          is_mobile?: boolean;
          project_id?: string;
          slug?: string;
          sort_order?: number;
          width?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'viewports_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'viewports_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects_public';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      projects_public: {
        Row: {
          archived_at: string | null;
          baseline_run_id: string | null;
          basic_auth_user: string | null;
          capture_concurrency: number;
          change_threshold_pct: number;
          check_redirects: boolean;
          created_at: string;
          created_by: string | null;
          diff_threshold: number;
          extra_css: string | null;
          file_extensions: string[] | null;
          has_basic_auth: boolean | null;
          hide_selectors: string[];
          id: string;
          max_page_height: number;
          name: string;
          notes: string | null;
          page_timeout_ms: number;
          r2_bucket: string;
          r2_public_url: string | null;
          settle_ms: number;
          sitemap_index: string;
          slug: string;
        };
        ComputedFields: never;
        Insert: {
          archived_at?: string | null;
          baseline_run_id?: string | null;
          basic_auth_user?: string | null;
          capture_concurrency?: number | null;
          change_threshold_pct?: number | null;
          check_redirects?: boolean | null;
          created_at?: string | null;
          created_by?: string | null;
          diff_threshold?: number | null;
          extra_css?: string | null;
          file_extensions?: string[] | null;
          has_basic_auth?: never;
          hide_selectors?: string[] | null;
          id?: string | null;
          max_page_height?: number | null;
          name?: string | null;
          notes?: string | null;
          page_timeout_ms?: number | null;
          r2_bucket?: string | null;
          r2_public_url?: string | null;
          settle_ms?: number | null;
          sitemap_index?: string | null;
          slug?: string | null;
        };
        Update: {
          archived_at?: string | null;
          baseline_run_id?: string | null;
          basic_auth_user?: string | null;
          capture_concurrency?: number | null;
          change_threshold_pct?: number | null;
          check_redirects?: boolean | null;
          created_at?: string | null;
          created_by?: string | null;
          diff_threshold?: number | null;
          extra_css?: string | null;
          file_extensions?: string[] | null;
          has_basic_auth?: never;
          hide_selectors?: string[] | null;
          id?: string | null;
          max_page_height?: number | null;
          name?: string | null;
          notes?: string | null;
          page_timeout_ms?: number | null;
          r2_bucket?: string | null;
          r2_public_url?: string | null;
          settle_ms?: number | null;
          sitemap_index?: string | null;
          slug?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'projects_baseline_run_id_fkey';
            columns: ['id', 'baseline_run_id'];
            isOneToOne: false;
            referencedRelation: 'runs';
            referencedColumns: ['project_id', 'id'];
          },
          {
            foreignKeyName: 'projects_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      run_sizes: {
        Row: {
          bytes: number | null;
          objects: number | null;
          run_id: string;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: 'run_items_run_id_fkey';
            columns: ['run_id'];
            isOneToOne: false;
            referencedRelation: 'runs';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Functions: {
      before_user_created_hook: { Args: { event: Json }; Returns: Json };
      can_admin: { Args: { p_project_id: string }; Returns: boolean };
      can_edit: { Args: { p_project_id: string }; Returns: boolean };
      can_view: { Args: { p_project_id: string }; Returns: boolean };
      channel_project_id: { Args: { p_channel_id: string }; Returns: string };
      comparison_project_id: { Args: { p_comparison_id: string }; Returns: string };
      is_platform_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      project_role: {
        Args: { p_project_id: string };
        Returns: Database['public']['Enums']['project_role'];
      };
      refresh_comparison_counts: { Args: { p_id: string }; Returns: undefined };
      refresh_run_counts: { Args: { p_run_id: string }; Returns: undefined };
      resolve_share_token: { Args: { p_token: string }; Returns: string };
      review_items: {
        Args: {
          p_comparison_id: string;
          p_item_ids: string[];
          p_note?: string;
          p_review: Database['public']['Enums']['review_status'];
        };
        Returns: number;
      };
      run_item_stats: {
        Args: { p_run_ids: string[] };
        Returns: {
          bytes: number;
          items: number;
          run_id: string;
          status: Database['public']['Enums']['item_status'];
          viewport_slug: string;
        }[];
      };
      run_project_id: { Args: { p_run_id: string }; Returns: string };
      set_baseline: { Args: { p_project_id: string; p_run_id: string }; Returns: undefined };
      shares_project: { Args: { p_user_id: string }; Returns: boolean };
      snapshot_project_id: { Args: { p_snapshot_id: string }; Returns: string };
      write_audit_log: {
        Args: { p_action: string; p_details?: Json; p_project_id?: string };
        Returns: string;
      };
    };
    Enums: {
      channel_type: 'email' | 'slack';
      cmp_item_status:
        'pending' | 'changed' | 'unchanged' | 'new' | 'missing' | 'redirect' | 'error';
      comparison_status:
        'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'deleting' | 'delete_failed';
      ignore_rule_type: 'url_pattern' | 'selector' | 'region';
      item_kind: 'page' | 'file';
      item_status: 'pending' | 'processing' | 'done' | 'failed' | 'skipped';
      project_role: 'admin' | 'editor' | 'viewer';
      review_status: 'pending' | 'approved' | 'rejected' | 'ignored';
      run_status:
        | 'queued'
        | 'running'
        | 'completed'
        | 'completed_with_errors'
        | 'failed'
        | 'cancelled'
        | 'deleting'
        | 'delete_failed';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      channel_type: ['email', 'slack'],
      cmp_item_status: ['pending', 'changed', 'unchanged', 'new', 'missing', 'redirect', 'error'],
      comparison_status: [
        'queued',
        'running',
        'completed',
        'failed',
        'cancelled',
        'deleting',
        'delete_failed',
      ],
      ignore_rule_type: ['url_pattern', 'selector', 'region'],
      item_kind: ['page', 'file'],
      item_status: ['pending', 'processing', 'done', 'failed', 'skipped'],
      project_role: ['admin', 'editor', 'viewer'],
      review_status: ['pending', 'approved', 'rejected', 'ignored'],
      run_status: [
        'queued',
        'running',
        'completed',
        'completed_with_errors',
        'failed',
        'cancelled',
        'deleting',
        'delete_failed',
      ],
    },
  },
} as const;
