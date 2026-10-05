export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alerts: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          last_notified_at: string | null
          site_id: string
          trigger_on: string[]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_notified_at?: string | null
          site_id: string
          trigger_on?: string[]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_notified_at?: string | null
          site_id?: string
          trigger_on?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_rate_limits: {
        Row: {
          attempted_at: string
          id: string
          ip: string
          kind: string
        }
        Insert: {
          attempted_at?: string
          id?: string
          ip: string
          kind: string
        }
        Update: {
          attempted_at?: string
          id?: string
          ip?: string
          kind?: string
        }
        Relationships: []
      }
      favorites: {
        Row: {
          created_at: string
          id: string
          site_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          site_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          site_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      gauge_readings: {
        Row: {
          created_at: string | null
          flow_cfs: number | null
          id: string
          qualifier: string | null
          raw_json: Json | null
          recorded_at: string
          stage_ft: number | null
          station_id: string
          trend: string | null
        }
        Insert: {
          created_at?: string | null
          flow_cfs?: number | null
          id?: string
          qualifier?: string | null
          raw_json?: Json | null
          recorded_at: string
          stage_ft?: number | null
          station_id: string
          trend?: string | null
        }
        Update: {
          created_at?: string | null
          flow_cfs?: number | null
          id?: string
          qualifier?: string | null
          raw_json?: Json | null
          recorded_at?: string
          stage_ft?: number | null
          station_id?: string
          trend?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_gauge_readings_station"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "river_gauges"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_alerts: {
        Row: {
          created_at: string
          email: string
          id: string
          site_id: string
          token: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          site_id: string
          token?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          site_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_alerts_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      ingest_runs: {
        Row: {
          created_at: string
          error: string | null
          finished_at: string
          function_name: string
          id: string
          rows_upserted: number
          run_name: string
          started_at: string
          status: string
          summary: Json | null
          tiles_processed: number
        }
        Insert: {
          created_at?: string
          error?: string | null
          finished_at?: string
          function_name?: string
          id?: string
          rows_upserted?: number
          run_name?: string
          started_at: string
          status: string
          summary?: Json | null
          tiles_processed?: number
        }
        Update: {
          created_at?: string
          error?: string | null
          finished_at?: string
          function_name?: string
          id?: string
          rows_upserted?: number
          run_name?: string
          started_at?: string
          status?: string
          summary?: Json | null
          tiles_processed?: number
        }
        Relationships: []
      }
      monitoring_stations: {
        Row: {
          agency: string
          characteristics: string[]
          county: string | null
          created_at: string
          data_source: string
          huc8: string | null
          id: string
          is_active: boolean
          is_tidal: boolean
          last_sample_at: string | null
          lat: number
          lng: number
          location_type: string | null
          org_identifier: string | null
          state_code: string | null
          station_code: string
          station_name: string
          typical_cadence_days: number | null
        }
        Insert: {
          agency: string
          characteristics?: string[]
          county?: string | null
          created_at?: string
          data_source: string
          huc8?: string | null
          id?: string
          is_active?: boolean
          is_tidal?: boolean
          last_sample_at?: string | null
          lat: number
          lng: number
          location_type?: string | null
          org_identifier?: string | null
          state_code?: string | null
          station_code: string
          station_name: string
          typical_cadence_days?: number | null
        }
        Update: {
          agency?: string
          characteristics?: string[]
          county?: string | null
          created_at?: string
          data_source?: string
          huc8?: string | null
          id?: string
          is_active?: boolean
          is_tidal?: boolean
          last_sample_at?: string | null
          lat?: number
          lng?: number
          location_type?: string | null
          org_identifier?: string | null
          state_code?: string | null
          station_code?: string
          station_name?: string
          typical_cadence_days?: number | null
        }
        Relationships: []
      }
      nettle_observations: {
        Row: {
          created_at: string
          id: string
          lat: number
          lng: number
          observed_at: string
          probability: number
          salinity_psu: number | null
          source: string
          station_code: string
          station_name: string | null
          water_temp_c: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          lat: number
          lng: number
          observed_at: string
          probability: number
          salinity_psu?: number | null
          source?: string
          station_code: string
          station_name?: string | null
          water_temp_c?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          lat?: number
          lng?: number
          observed_at?: string
          probability?: number
          salinity_psu?: number | null
          source?: string
          station_code?: string
          station_name?: string | null
          water_temp_c?: number | null
        }
        Relationships: []
      }
      preview_feedback: {
        Row: {
          created_at: string
          device_id: string
          id: string
          page_path: string | null
          prompt_key: string
          response_text: string | null
          response_value: string | null
        }
        Insert: {
          created_at?: string
          device_id: string
          id?: string
          page_path?: string | null
          prompt_key: string
          response_text?: string | null
          response_value?: string | null
        }
        Update: {
          created_at?: string
          device_id?: string
          id?: string
          page_path?: string | null
          prompt_key?: string
          response_text?: string | null
          response_value?: string | null
        }
        Relationships: []
      }
      rain_events: {
        Row: {
          advisory_active: boolean
          created_at: string
          id: string
          precipitation_inches_24h: number | null
          precipitation_inches_48h: number
          recorded_at: string
          station_id: string | null
        }
        Insert: {
          advisory_active?: boolean
          created_at?: string
          id?: string
          precipitation_inches_24h?: number | null
          precipitation_inches_48h: number
          recorded_at: string
          station_id?: string | null
        }
        Update: {
          advisory_active?: boolean
          created_at?: string
          id?: string
          precipitation_inches_24h?: number | null
          precipitation_inches_48h?: number
          recorded_at?: string
          station_id?: string | null
        }
        Relationships: []
      }
      readings: {
        Row: {
          created_at: string
          data_source: string
          e_coli_mpn: number | null
          enterococci_cce: number | null
          id: string
          ingested_at: string
          monitoring_station_id: string | null
          notes: string | null
          raw_payload: Json | null
          sample_method: string | null
          sampled_at: string
          site_id: string
          source_url: string | null
          status: string
        }
        Insert: {
          created_at?: string
          data_source: string
          e_coli_mpn?: number | null
          enterococci_cce?: number | null
          id?: string
          ingested_at?: string
          monitoring_station_id?: string | null
          notes?: string | null
          raw_payload?: Json | null
          sample_method?: string | null
          sampled_at: string
          site_id: string
          source_url?: string | null
          status: string
        }
        Update: {
          created_at?: string
          data_source?: string
          e_coli_mpn?: number | null
          enterococci_cce?: number | null
          id?: string
          ingested_at?: string
          monitoring_station_id?: string | null
          notes?: string | null
          raw_payload?: Json | null
          sample_method?: string | null
          sampled_at?: string
          site_id?: string
          source_url?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "readings_monitoring_station_id_fkey"
            columns: ["monitoring_station_id"]
            isOneToOne: false
            referencedRelation: "monitoring_stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "readings_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      river_gauges: {
        Row: {
          county: string | null
          created_at: string | null
          datum: string | null
          drainage_area_sq_mi: number | null
          id: string
          is_tidal: boolean | null
          lat: number
          lng: number
          name: string
          noaa_station_id: string | null
          site_id: string | null
          state_code: string | null
          tidal_notes: string | null
          usgs_site_number: string
        }
        Insert: {
          county?: string | null
          created_at?: string | null
          datum?: string | null
          drainage_area_sq_mi?: number | null
          id?: string
          is_tidal?: boolean | null
          lat: number
          lng: number
          name: string
          noaa_station_id?: string | null
          site_id?: string | null
          state_code?: string | null
          tidal_notes?: string | null
          usgs_site_number: string
        }
        Update: {
          county?: string | null
          created_at?: string | null
          datum?: string | null
          drainage_area_sq_mi?: number | null
          id?: string
          is_tidal?: boolean | null
          lat?: number
          lng?: number
          name?: string
          noaa_station_id?: string | null
          site_id?: string | null
          state_code?: string | null
          tidal_notes?: string | null
          usgs_site_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "river_gauges_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_station_assignments: {
        Row: {
          assignment_type: string
          created_at: string
          distance_m: number | null
          id: string
          is_primary: boolean
          priority: number
          site_id: string
          station_id: string
        }
        Insert: {
          assignment_type?: string
          created_at?: string
          distance_m?: number | null
          id?: string
          is_primary?: boolean
          priority?: number
          site_id: string
          station_id: string
        }
        Update: {
          assignment_type?: string
          created_at?: string
          distance_m?: number | null
          id?: string
          is_primary?: boolean
          priority?: number
          site_id?: string
          station_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_station_assignments_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_station_assignments_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "monitoring_stations"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          access_type: string | null
          ada_accessible: boolean
          address: string | null
          amenities: string[]
          county: string | null
          created_at: string
          data_source_ids: string[]
          description: string | null
          driving_directions: string | null
          id: string
          is_active: boolean
          is_tidal: boolean | null
          lat: number
          lng: number
          min_navigable_ft: number | null
          name: string
          nearest_gauge_id: string | null
          num_ramps: number | null
          osm_id: string | null
          owner_id: string | null
          parking_notes: string | null
          region: string | null
          site_type: string
          slug: string
          source: string | null
          source_external_id: string | null
          state_code: string | null
          status: string
          tidal_gauge_station_id: string | null
          updated_at: string
          water_body: string | null
          water_body_type: string
        }
        Insert: {
          access_type?: string | null
          ada_accessible?: boolean
          address?: string | null
          amenities?: string[]
          county?: string | null
          created_at?: string
          data_source_ids?: string[]
          description?: string | null
          driving_directions?: string | null
          id?: string
          is_active?: boolean
          is_tidal?: boolean | null
          lat: number
          lng: number
          min_navigable_ft?: number | null
          name: string
          nearest_gauge_id?: string | null
          num_ramps?: number | null
          osm_id?: string | null
          owner_id?: string | null
          parking_notes?: string | null
          region?: string | null
          site_type: string
          slug: string
          source?: string | null
          source_external_id?: string | null
          state_code?: string | null
          status?: string
          tidal_gauge_station_id?: string | null
          updated_at?: string
          water_body?: string | null
          water_body_type: string
        }
        Update: {
          access_type?: string | null
          ada_accessible?: boolean
          address?: string | null
          amenities?: string[]
          county?: string | null
          created_at?: string
          data_source_ids?: string[]
          description?: string | null
          driving_directions?: string | null
          id?: string
          is_active?: boolean
          is_tidal?: boolean | null
          lat?: number
          lng?: number
          min_navigable_ft?: number | null
          name?: string
          nearest_gauge_id?: string | null
          num_ramps?: number | null
          osm_id?: string | null
          owner_id?: string | null
          parking_notes?: string | null
          region?: string | null
          site_type?: string
          slug?: string
          source?: string | null
          source_external_id?: string | null
          state_code?: string | null
          status?: string
          tidal_gauge_station_id?: string | null
          updated_at?: string
          water_body?: string | null
          water_body_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "sites_nearest_gauge_id_fkey"
            columns: ["nearest_gauge_id"]
            isOneToOne: false
            referencedRelation: "river_gauges"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_thresholds: {
        Row: {
          caution_max_ft: number | null
          id: string
          notes: string | null
          optimal_max_ft: number | null
          optimal_min_ft: number | null
          station_id: string
          too_low_ft: number | null
        }
        Insert: {
          caution_max_ft?: number | null
          id?: string
          notes?: string | null
          optimal_max_ft?: number | null
          optimal_min_ft?: number | null
          station_id: string
          too_low_ft?: number | null
        }
        Update: {
          caution_max_ft?: number | null
          id?: string
          notes?: string | null
          optimal_max_ft?: number | null
          optimal_min_ft?: number | null
          station_id?: string
          too_low_ft?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stage_thresholds_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: true
            referencedRelation: "river_gauges"
            referencedColumns: ["id"]
          },
        ]
      }
      tidal_predictions: {
        Row: {
          fetched_at: string | null
          height_ft: number | null
          id: string
          noaa_station_id: string
          predicted_at: string
          type: string | null
        }
        Insert: {
          fetched_at?: string | null
          height_ft?: number | null
          id?: string
          noaa_station_id: string
          predicted_at: string
          type?: string | null
        }
        Update: {
          fetched_at?: string | null
          height_ft?: number | null
          id?: string
          noaa_station_id?: string
          predicted_at?: string
          type?: string | null
        }
        Relationships: []
      }
      trip_waypoints: {
        Row: {
          created_at: string | null
          custom_name: string | null
          distance_from_prev_nm: number | null
          estimated_arrival_at: string | null
          id: string
          lat: number
          lng: number
          minutes_to_slack: number | null
          noaa_station_id: string | null
          order_index: number
          site_id: string | null
          tide_direction: string | null
          tide_height_ft: number | null
          travel_time_minutes: number | null
          trip_id: string | null
          waypoint_type: string
        }
        Insert: {
          created_at?: string | null
          custom_name?: string | null
          distance_from_prev_nm?: number | null
          estimated_arrival_at?: string | null
          id?: string
          lat: number
          lng: number
          minutes_to_slack?: number | null
          noaa_station_id?: string | null
          order_index: number
          site_id?: string | null
          tide_direction?: string | null
          tide_height_ft?: number | null
          travel_time_minutes?: number | null
          trip_id?: string | null
          waypoint_type: string
        }
        Update: {
          created_at?: string | null
          custom_name?: string | null
          distance_from_prev_nm?: number | null
          estimated_arrival_at?: string | null
          id?: string
          lat?: number
          lng?: number
          minutes_to_slack?: number | null
          noaa_station_id?: string | null
          order_index?: number
          site_id?: string | null
          tide_direction?: string | null
          tide_height_ft?: number | null
          travel_time_minutes?: number | null
          trip_id?: string | null
          waypoint_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_waypoints_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_waypoints_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          created_at: string | null
          departure_time: string | null
          id: string
          is_public: boolean | null
          name: string
          notes: string | null
          paddling_speed_knots: number | null
          trip_type: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          departure_time?: string | null
          id?: string
          is_public?: boolean | null
          name: string
          notes?: string | null
          paddling_speed_knots?: number | null
          trip_type: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          departure_time?: string | null
          id?: string
          is_public?: boolean | null
          name?: string
          notes?: string | null
          paddling_speed_knots?: number | null
          trip_type?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email_alerts_enabled: boolean
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email_alerts_enabled?: boolean
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email_alerts_enabled?: boolean
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      water_quality_advisories: {
        Row: {
          advisory_type: string
          created_at: string | null
          description: string | null
          effective_at: string
          expires_at: string | null
          headline: string | null
          id: string
          is_active: boolean | null
          issuing_agency: string
          raw_json: Json | null
          site_id: string | null
          source_url: string | null
          updated_at: string | null
        }
        Insert: {
          advisory_type: string
          created_at?: string | null
          description?: string | null
          effective_at: string
          expires_at?: string | null
          headline?: string | null
          id?: string
          is_active?: boolean | null
          issuing_agency: string
          raw_json?: Json | null
          site_id?: string | null
          source_url?: string | null
          updated_at?: string | null
        }
        Update: {
          advisory_type?: string
          created_at?: string | null
          description?: string | null
          effective_at?: string
          expires_at?: string | null
          headline?: string | null
          id?: string
          is_active?: boolean | null
          issuing_agency?: string
          raw_json?: Json | null
          site_id?: string | null
          source_url?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "water_quality_advisories_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      water_temp_observations: {
        Row: {
          created_at: string
          depth_m: number | null
          id: string
          lat: number
          lng: number
          observed_at: string
          qa: string | null
          source: string
          station_code: string
          station_name: string | null
          temp_c: number
          time_series_id: string | null
        }
        Insert: {
          created_at?: string
          depth_m?: number | null
          id?: string
          lat: number
          lng: number
          observed_at: string
          qa?: string | null
          source: string
          station_code: string
          station_name?: string | null
          temp_c: number
          time_series_id?: string | null
        }
        Update: {
          created_at?: string
          depth_m?: number | null
          id?: string
          lat?: number
          lng?: number
          observed_at?: string
          qa?: string | null
          source?: string
          station_code?: string
          station_name?: string | null
          temp_c?: number
          time_series_id?: string | null
        }
        Relationships: []
      }
      weather_alert_notifications: {
        Row: {
          alert_id: string
          id: string
          notified_at: string
          nws_alert_id: string
        }
        Insert: {
          alert_id: string
          id?: string
          notified_at?: string
          nws_alert_id: string
        }
        Update: {
          alert_id?: string
          id?: string
          notified_at?: string
          nws_alert_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "weather_alert_notifications_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      weather_alerts: {
        Row: {
          area_desc: string | null
          description: string | null
          effective_at: string | null
          event: string
          expires_at: string | null
          fetched_at: string | null
          headline: string | null
          id: string
          lat: number | null
          lng: number | null
          nws_alert_id: string
          raw_json: Json | null
          severity: string | null
          urgency: string | null
        }
        Insert: {
          area_desc?: string | null
          description?: string | null
          effective_at?: string | null
          event: string
          expires_at?: string | null
          fetched_at?: string | null
          headline?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          nws_alert_id: string
          raw_json?: Json | null
          severity?: string | null
          urgency?: string | null
        }
        Update: {
          area_desc?: string | null
          description?: string | null
          effective_at?: string | null
          event?: string
          expires_at?: string | null
          fetched_at?: string | null
          headline?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          nws_alert_id?: string
          raw_json?: Json | null
          severity?: string | null
          urgency?: string | null
        }
        Relationships: []
      }
      weather_readings: {
        Row: {
          fetched_at: string | null
          id: string
          observed_at: string
          precip_last_24h_in: number | null
          precip_probability_pct: number | null
          raw_json: Json | null
          short_forecast: string | null
          station_lat: number
          station_lng: number
          temperature_f: number | null
          wind_direction_deg: number | null
          wind_direction_text: string | null
          wind_gust_mph: number | null
          wind_speed_mph: number | null
        }
        Insert: {
          fetched_at?: string | null
          id?: string
          observed_at: string
          precip_last_24h_in?: number | null
          precip_probability_pct?: number | null
          raw_json?: Json | null
          short_forecast?: string | null
          station_lat?: number
          station_lng?: number
          temperature_f?: number | null
          wind_direction_deg?: number | null
          wind_direction_text?: string | null
          wind_gust_mph?: number | null
          wind_speed_mph?: number | null
        }
        Update: {
          fetched_at?: string | null
          id?: string
          observed_at?: string
          precip_last_24h_in?: number | null
          precip_probability_pct?: number | null
          raw_json?: Json | null
          short_forecast?: string | null
          station_lat?: number
          station_lng?: number
          temperature_f?: number | null
          wind_direction_deg?: number | null
          wind_direction_text?: string | null
          wind_gust_mph?: number | null
          wind_speed_mph?: number | null
        }
        Relationships: []
      }
      weekly_report_state: {
        Row: {
          id: string
          last_sent_at: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          last_sent_at?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          last_sent_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_todays_tides: {
        Row: {
          event_order: number | null
          height_ft: number | null
          noaa_station_id: string | null
          predicted_at: string | null
          type: string | null
        }
        Relationships: []
      }
      v_upcoming_tides: {
        Row: {
          event_order: number | null
          height_ft: number | null
          noaa_station_id: string | null
          predicted_at: string | null
          tide_date: string | null
          type: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _get_vault_secret: { Args: { p_name: string }; Returns: string }
      bulk_update_last_sample_at: { Args: { p_rows: Json }; Returns: number }
      calculate_trip_waypoints: {
        Args: {
          p_departure_time?: string
          p_speed_knots?: number
          p_waypoints: Json
        }
        Returns: Json
      }
      find_best_departure: {
        Args: {
          p_date?: string
          p_dest_station: string
          p_origin_station: string
          p_paddling_speed_kts?: number
          p_travel_minutes?: number
        }
        Returns: {
          arrival_direction: string
          arrival_tide_state: string
          arrival_time: string
          departure_direction: string
          departure_tide_state: string
          departure_time: string
          estimated_home_time: string
          recommendation: string
          return_departure_time: string
          return_direction: string
          return_tide_state: string
          window_quality: string
        }[]
      }
      get_current_tide: {
        Args: { p_at?: string; p_station_id: string }
        Returns: {
          direction: string
          height_ft: number
          minutes_to_slack: number
          next_event_time: string
          next_event_type: string
          next_height_ft: number
          prev_event_time: string
          prev_event_type: string
          prev_height_ft: number
        }[]
      }
      get_site_readings_history: {
        Args: { days_back?: number; p_site_id: string }
        Returns: {
          created_at: string
          data_source: string
          e_coli_mpn: number | null
          enterococci_cce: number | null
          id: string
          ingested_at: string
          monitoring_station_id: string | null
          notes: string | null
          raw_payload: Json | null
          sample_method: string | null
          sampled_at: string
          site_id: string
          source_url: string | null
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "readings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_sites_with_latest_reading: {
        Args: {
          requesting_user_id?: string
          user_lat: number
          user_lng: number
        }
        Returns: {
          ada_accessible: boolean
          address: string
          amenities: string[]
          data_source: string
          data_source_ids: string[]
          description: string
          distance_km: number
          e_coli_mpn: number
          enterococci_cce: number
          ingested_at: string
          is_active: boolean
          lat: number
          lng: number
          name: string
          notes: string
          osm_id: string
          parking_notes: string
          reading_id: string
          sample_method: string
          sampled_at: string
          site_id: string
          site_type: string
          slug: string
          source_url: string
          status: string
          water_body_type: string
        }[]
      }
      nearest_water_temp: {
        Args: { p_lat: number; p_lng: number; p_max_km?: number }
        Returns: {
          distance_km: number
          observed_at: string
          source: string
          station_name: string
          temp_c: number
        }[]
      }
      purge_old_auth_rate_limits: { Args: never; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
