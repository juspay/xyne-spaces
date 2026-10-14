package net.juspay.xynespaces.http

import java.net.URI
import net.juspay.xynespaces.BuildConfig

/** Native transport allowlist shared by the HTTP and WebSocket bridges. */
object MtlsTransportPolicy {
    private val configuredApiOrigin: Origin? by lazy {
        parseOrigin(BuildConfig.API_ORIGIN)
    }
    private val configuredDashboardOrigin: Origin? by lazy {
        parseOrigin(BuildConfig.DASHBOARD_ORIGIN)
    }

    fun isApprovedHttpUrl(rawUrl: String): Boolean {
        val uri = parseUri(rawUrl) ?: return false
        if (uri.userInfo != null || uri.fragment != null) return false

        val scheme = uri.scheme?.lowercase() ?: return false
        val host = uri.host ?: return false
        if (isLoopbackHost(host)) {
            return scheme == "http" || scheme == "https"
        }

        return scheme == "https" && sameOrigin(uri, configuredApiOrigin)
    }

    fun isApprovedWebSocketUrl(rawUrl: String): Boolean {
        val uri = parseUri(rawUrl) ?: return false
        if (uri.userInfo != null || uri.fragment != null) return false

        val scheme = uri.scheme?.lowercase() ?: return false
        val host = uri.host ?: return false
        if (isLoopbackHost(host)) {
            return scheme == "ws" || scheme == "wss"
        }

        return scheme == "wss" && sameOrigin(uri, configuredApiOrigin)
    }

    /**
     * WebView client certificates are identity-bearing credentials. Only the
     * configured API/dashboard TLS origins may request the enrolled identity.
     */
    fun isApprovedWebViewClientCertificateRequest(host: String?, port: Int): Boolean {
        val normalizedHost = host?.lowercase()?.trim()?.removePrefix("[")?.removeSuffix("]")
            ?: return false
        if (normalizedHost.isEmpty() || port !in 1..65535) return false
        return matchesOrigin(normalizedHost, port, configuredApiOrigin) ||
            matchesOrigin(normalizedHost, port, configuredDashboardOrigin)
    }

    private data class Origin(val scheme: String, val host: String, val port: Int)

    private fun parseOrigin(raw: String): Origin? {
        val uri = parseUri(raw) ?: return null
        val scheme = uri.scheme?.lowercase() ?: return null
        val host = uri.host?.lowercase() ?: return null
        if (uri.userInfo != null || uri.query != null || uri.fragment != null) return null
        if (scheme != "http" && scheme != "https") return null
        val port = effectivePort(uri, scheme) ?: return null
        return Origin(scheme, host, port)
    }

    private fun sameOrigin(uri: URI, expected: Origin?): Boolean {
        val scheme = uri.scheme?.lowercase() ?: return false
        val host = uri.host?.lowercase() ?: return false
        val port = effectivePort(uri, scheme) ?: return false
        val originScheme = when (scheme) {
            "ws" -> "http"
            "wss" -> "https"
            else -> scheme
        }
        return expected != null && originScheme == expected.scheme && host == expected.host && port == expected.port
    }

    private fun matchesOrigin(host: String, port: Int, expected: Origin?): Boolean =
        expected != null && expected.scheme == "https" && expected.host == host && expected.port == port

    private fun effectivePort(uri: URI, scheme: String): Int? {
        if (uri.port >= 0) return uri.port
        return when (scheme) {
            "http", "ws" -> 80
            "https", "wss" -> 443
            else -> null
        }
    }

    private fun parseUri(rawUrl: String): URI? = try {
        URI(rawUrl)
    } catch (_: Exception) {
        null
    }

    private fun isLoopbackHost(host: String): Boolean {
        val normalized = host.lowercase().removePrefix("[").removeSuffix("]")
        return normalized == "localhost" || normalized == "127.0.0.1" || normalized == "::1"
    }
}
