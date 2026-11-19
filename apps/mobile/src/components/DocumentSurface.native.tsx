import { useCallback, useRef } from "react";
import { WebView } from "react-native-webview";
import { editorHtml } from "../../editor/generated";
import { useDocumentBridge } from "./useDocumentBridge";
import type { DocumentSurfaceProps } from "./DocumentSurface.types";
export type { DocumentSurfaceProps, SurfaceCommand } from "./DocumentSurface.types";
const source = { html: editorHtml, baseUrl: "about:blank" };
function NativeSurface(props: DocumentSurfaceProps) {
  const webview = useRef<WebView<object>>(null);
  const deliver = useCallback((message: string) => {
    webview.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(message)}}));true;`,
    );
  }, []);
  const { receive, probe } = useDocumentBridge(props, deliver);
  return (
    <WebView<object>
      ref={webview}
      source={source}
      originWhitelist={["about:blank"]}
      onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
      onMessage={(event) => receive(event.nativeEvent.data)}
      onLoadEnd={probe}
      onError={() =>
        props.onError?.("The offline editor could not load. Your note is still in the app.")
      }
      onContentProcessDidTerminate={() => webview.current?.reload()}
      javaScriptEnabled
      domStorageEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      mixedContentMode="never"
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      setSupportMultipleWindows={false}
      javaScriptCanOpenWindowsAutomatically={false}
      hideKeyboardAccessoryView
      keyboardDisplayRequiresUserAction={false}
      automaticallyAdjustContentInsets={false}
      contentInsetAdjustmentBehavior="never"
      scrollEnabled={false}
      style={{ flex: 1, backgroundColor: props.dark ? "#242521" : "#faf9f5" }}
    />
  );
}
export function DocumentSurface(props: DocumentSurfaceProps) {
  return <NativeSurface key={props.documentId} {...props} />;
}
export default DocumentSurface;
