type Widget = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      cData: string;
      callback: (token: string) => void;
      "error-callback": () => void;
      "expired-callback": () => void;
    },
  ) => string;
  remove: (id: string) => void;
};
const api = () => (window as Window & { turnstile?: Widget }).turnstile;
let loading: Promise<void> | undefined;
async function load() {
  if (api()) return;
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      const timer = setTimeout(() => {
        script.remove();
        reject(Error("No pudimos cargar la verificación. Volvé a intentar."));
      }, 10000);
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = () => {
        clearTimeout(timer);
        if (api()) resolve();
        else
          reject(Error("No pudimos cargar la verificación. Volvé a intentar."));
      };
      script.onerror = () => {
        clearTimeout(timer);
        script.remove();
        reject(Error("No pudimos cargar la verificación. Volvé a intentar."));
      };
      document.head.append(script);
    }).catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
  }
  await loading;
}
export async function solveHuman(input: {
  site_key: string;
  action: string;
  cdata: string;
}) {
  await load();
  return new Promise<string>((resolve, reject) => {
    const dialog = document.createElement("dialog");
    dialog.className = "product-card";
    dialog.style.color = "var(--foreground)";
    const title = document.createElement("h2");
    title.id = `human-${crypto.randomUUID()}`;
    title.textContent = "Verificá que sos una persona";
    dialog.setAttribute("aria-labelledby", title.id);
    dialog.style.maxWidth = "calc(100vw - 2rem)";
    const container = document.createElement("div"),
      cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancelar verificación";
    dialog.append(title, container, cancel);
    document.body.append(dialog);
    let id: string | undefined,
      finished = false;
    const finish = (token?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (id !== undefined) api()?.remove(id);
      dialog.close();
      dialog.remove();
      if (token) resolve(token);
      else reject(Error("No pudimos verificarte. Volvé a intentar."));
    };
    const timer = setTimeout(() => finish(), 60000);
    cancel.onclick = () => finish();
    dialog.oncancel = (event) => {
      event.preventDefault();
      finish();
    };
    try {
      dialog.showModal();
      id = api()!.render(container, {
        sitekey: input.site_key,
        action: input.action,
        cData: input.cdata,
        callback: (token) => finish(token),
        "error-callback": () => finish(),
        "expired-callback": () => finish(),
      });
    } catch {
      finish();
    }
  });
}
