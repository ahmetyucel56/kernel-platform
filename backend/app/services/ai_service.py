"""Tek AI servis katmani (spec Bolum 3 kritik mimari kurali).

Tum AI cagrilari buradan gecer. Provider ve model adi config'ten okunur;
kodun geri kalani hangi saglayiciyi/modeli kullandigini bilmez. Ileride
OpenAI vb. eklemek icin yalnizca yeni bir Provider sinifi + config secenegi
gerekir.

Sprint 0'da yalnizca iskelet + 'mock' saglayici vardir; gercek analiz
prompt'lari Sprint 3'te bu katmanin ustune eklenecek.
"""
from __future__ import annotations

from abc import ABC, abstractmethod

from app.config import settings


class AIProvider(ABC):
    """Bir AI saglayicisinin sozlesmesi."""

    @abstractmethod
    def complete(self, system: str, prompt: str, *, max_tokens: int = 1024) -> str:
        """Verilen sistem + kullanici prompt'una metin yanit dondurur."""
        ...


class MockProvider(AIProvider):
    """API anahtari olmadan calisan sahte saglayici (gelistirme/demo)."""

    def complete(self, system: str, prompt: str, *, max_tokens: int = 1024) -> str:
        return (
            "[MOCK AI] Bu, AI_PROVIDER=mock oldugu icin uretilen sahte bir yanittir. "
            "Gercek analiz icin .env dosyasinda AI_PROVIDER=anthropic ve "
            "ANTHROPIC_API_KEY ayarlayin."
        )


class AnthropicProvider(AIProvider):
    """Claude API saglayicisi. Model adi config'ten (settings.ai_model) gelir."""

    def __init__(self) -> None:
        if not settings.anthropic_api_key:
            raise RuntimeError(
                "AI_PROVIDER=anthropic secildi ancak ANTHROPIC_API_KEY tanimli degil."
            )
        # Import burada: mock modda anthropic paketi yuklu olmasa da uygulama calisir.
        from anthropic import Anthropic

        self._client = Anthropic(api_key=settings.anthropic_api_key)

    def complete(self, system: str, prompt: str, *, max_tokens: int = 1024) -> str:
        msg = self._client.messages.create(
            model=settings.ai_model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        parts = [b.text for b in msg.content if getattr(b, "type", None) == "text"]
        return "".join(parts)


_PROVIDERS = {
    "mock": MockProvider,
    "anthropic": AnthropicProvider,
}


def get_ai_provider() -> AIProvider:
    """Config'e gore aktif AI saglayicisini dondurur."""
    provider_cls = _PROVIDERS.get(settings.ai_provider)
    if provider_cls is None:
        raise RuntimeError(f"Bilinmeyen AI_PROVIDER: {settings.ai_provider!r}")
    return provider_cls()
