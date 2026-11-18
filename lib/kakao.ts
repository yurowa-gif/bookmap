// 카카오맵 JavaScript SDK를 한 번만 불러온다. 쓰는 부분만 타입을 적어 둔다.

export interface KakaoLatLng {
  getLat(): number;
  getLng(): number;
}

export interface KakaoMap {
  setCenter(position: KakaoLatLng): void;
  setBounds(bounds: KakaoBounds, paddingTop?: number, paddingRight?: number, paddingBottom?: number, paddingLeft?: number): void;
  getCenter(): KakaoLatLng;
  relayout(): void;
}

export interface KakaoBounds {
  extend(position: KakaoLatLng): void;
}

export interface KakaoOverlay {
  setMap(map: KakaoMap | null): void;
}

export interface KakaoPlaceResult {
  id: string;
  place_name: string;
  address_name: string;
  road_address_name: string;
  category_group_name: string;
  x: string; // 경도
  y: string; // 위도
}

export interface KakaoNamespace {
  maps: {
    load(callback: () => void): void;
    LatLng: new (lat: number, lng: number) => KakaoLatLng;
    LatLngBounds: new () => KakaoBounds;
    Map: new (container: HTMLElement, options: { center: KakaoLatLng; level: number }) => KakaoMap;
    CustomOverlay: new (options: {
      position: KakaoLatLng;
      content: HTMLElement;
      yAnchor?: number;
      xAnchor?: number;
      clickable?: boolean;
      zIndex?: number;
    }) => KakaoOverlay;
    services: {
      Places: new () => {
        keywordSearch(
          keyword: string,
          callback: (result: KakaoPlaceResult[], status: string) => void,
          options?: { location?: KakaoLatLng; radius?: number; size?: number },
        ): void;
      };
      Status: { OK: string; ZERO_RESULT: string; ERROR: string };
    };
  };
}

declare global {
  interface Window {
    kakao?: KakaoNamespace;
  }
}

const appKey = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;

export const hasKakaoKey = Boolean(appKey);

/** 서촌 일대의 기본 중심(경복궁역 근처). 장소가 하나도 없을 때 쓴다. */
export const DEFAULT_CENTER = { lat: 37.5779, lng: 126.9706 };

let loading: Promise<KakaoNamespace> | null = null;

export function loadKakao(): Promise<KakaoNamespace> {
  if (!appKey) return Promise.reject(new Error("KAKAO_KEY_MISSING"));
  loading ??= new Promise<KakaoNamespace>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&libraries=services&autoload=false`;
    script.async = true;
    const timer = window.setTimeout(() => reject(new Error("KAKAO_TIMEOUT")), 12_000);
    script.onload = () => {
      const kakao = window.kakao;
      if (!kakao) {
        window.clearTimeout(timer);
        reject(new Error("KAKAO_LOAD_FAILED"));
        return;
      }
      kakao.maps.load(() => {
        window.clearTimeout(timer);
        resolve(kakao);
      });
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("KAKAO_LOAD_FAILED"));
    };
    document.head.appendChild(script);
  }).catch((error) => {
    loading = null; // 다음에 다시 시도할 수 있게 한다.
    throw error;
  });
  return loading;
}

/** 이름으로 장소를 찾는다. 중심 좌표에서 가까운 결과가 먼저 온다. */
export async function searchPlaces(keyword: string, near: { lat: number; lng: number }): Promise<KakaoPlaceResult[]> {
  const kakao = await loadKakao();
  return new Promise((resolve, reject) => {
    new kakao.maps.services.Places().keywordSearch(
      keyword,
      (result, status) => {
        if (status === kakao.maps.services.Status.OK) resolve(result);
        else if (status === kakao.maps.services.Status.ZERO_RESULT) resolve([]);
        else reject(new Error("KAKAO_SEARCH_FAILED"));
      },
      { location: new kakao.maps.LatLng(near.lat, near.lng), radius: 3000, size: 10 },
    );
  });
}
