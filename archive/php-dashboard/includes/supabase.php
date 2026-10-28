<?php
require_once __DIR__ . '/../config/config.php';

/**
 * Supabase client for PHP
 */
class SupabaseClient {
    private $url;
    private $key;

    public function __construct($url, $key) {
        $this->url = $url;
        $this->key = $key;
    }

    /**
     * Perform a SELECT query on a table
     */
    public function from($table, $select = '*', $order = null, $limit = null) {
        $params = [
            'select' => $select
        ];

        if ($order) $params['order'] = $order;
        if ($limit) $params['limit'] = $limit;

        $queryString = http_build_query($params);
        $endpoint = "{$this->url}/rest/v1/{$table}?{$queryString}";

        return $this->request('GET', $endpoint);
    }

    /**
     * Get aggregate counts or specific stats
     */
    public function getCount($table) {
        $endpoint = "{$this->url}/rest/v1/{$table}?select=count";
        $headers = [
            "Prefer: count=exact"
        ];
        
        $response = $this->request('GET', $endpoint, null, $headers);
        return $response;
    }

    /**
     * Generic request handler
     */
    private function request($method, $url, $data = null, $additionalHeaders = []) {
        $ch = curl_init($url);
        
        $headers = [
            "apikey: {$this->key}",
            "Authorization: Bearer {$this->key}",
            "Content-Type: application/json"
        ];

        if (!empty($additionalHeaders)) {
            $headers = array_merge($headers, $additionalHeaders);
        }

        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);

        if ($data) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
        }

        // Bypass SSL verification for local/dev if needed (not recommended for production)
        // curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        
        if (curl_errno($ch)) {
            return ['error' => curl_error($ch)];
        }
        
        curl_close($ch);
        
        return json_decode($response, true);
    }
}

// Global instance
$supabase = new SupabaseClient(SUPABASE_URL, SUPABASE_KEY);
?>
