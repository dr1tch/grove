import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import {
  captchaMessage,
  captchaNavigation,
  captchaPage,
  trustedCaptchaSource,
} from "../auth-captcha";
import { theme } from "../theme";
import type { CaptchaProps } from "./Captcha.types";

export function Captcha({ url, attempt, dark, onToken }: CaptchaProps) {
  const page = captchaPage(url, attempt, dark);
  const ref = useRef<WebView<object>>(null);
  const currentPage = useRef("");
  const [failed, setFailed] = useState(false);
  const palette = theme(dark);
  useEffect(() => {
    onToken("");
    setFailed(false);
    return () => onToken("");
  }, [page, onToken]);
  return (
    <View style={{ minHeight: 110 }}>
      <WebView<object>
        key={page}
        ref={ref}
        source={{ uri: page }}
        originWhitelist={["https://*"]}
        onLoadStart={(event) => {
          currentPage.current = event.nativeEvent.url;
          onToken("");
        }}
        onNavigationStateChange={(state) => {
          currentPage.current = state.url;
        }}
        onShouldStartLoadWithRequest={(request) =>
          captchaNavigation(request.url, page, request.isTopFrame)
        }
        onMessage={(event) => {
          if (!trustedCaptchaSource(event.nativeEvent.url, currentPage.current, page)) return;
          const token = captchaMessage(event.nativeEvent.data, attempt);
          if (token !== undefined) onToken(token);
        }}
        onError={() => {
          onToken("");
          setFailed(true);
        }}
        onHttpError={() => {
          onToken("");
          setFailed(true);
        }}
        onContentProcessDidTerminate={() => {
          onToken("");
          ref.current?.reload();
        }}
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never"
        setSupportMultipleWindows={false}
        javaScriptCanOpenWindowsAutomatically={false}
        scrollEnabled={false}
        style={{ height: 110, backgroundColor: palette.background }}
      />
      {failed && (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setFailed(false);
            ref.current?.reload();
          }}
          style={{ padding: 12 }}
        >
          <Text style={{ color: palette.text }}>Verification could not load. Tap to retry.</Text>
        </Pressable>
      )}
    </View>
  );
}
