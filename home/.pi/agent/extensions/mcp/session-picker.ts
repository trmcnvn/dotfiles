import { DynamicBorder, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Container, SelectList, Text, type SelectItem } from "@mariozechner/pi-tui";

export const selectSessionDiscoverabilityChoice = async (
  ctx: ExtensionContext,
  sortedServerNames: readonly string[],
  desiredEnabledServers: ReadonlySet<string>,
): Promise<string | null | undefined> =>
  await ctx.ui.custom<string | null | undefined>((tui, theme, _kb, done) => {
    const items: SelectItem[] = [
      { value: "__done__", label: "Done" },
      { value: "__enable_all__", label: "Enable all" },
      { value: "__disable_all__", label: "Disable all" },
      ...sortedServerNames.map((serverName) => {
        const checkmark = desiredEnabledServers.has(serverName)
          ? theme.fg("success", "✓")
          : " ";

        return {
          value: serverName,
          label: `${checkmark} ${serverName}`,
        };
      }),
    ];

    const container = new Container();
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    container.addChild(
      new Text(theme.fg("accent", theme.bold("MCP servers (✓ enabled)")), 1, 0),
    );

    const selectList = new SelectList(items, Math.min(items.length, 14), {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => text,
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });
    selectList.onSelect = (item) => done(item.value);
    selectList.onCancel = () => done(null);
    container.addChild(selectList);
    container.addChild(
      new Text(theme.fg("dim", "↑↓ navigate • enter toggle • esc done"), 1, 0),
    );
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

    return {
      render(width: number) {
        return container.render(width);
      },
      invalidate() {
        container.invalidate();
      },
      handleInput(data: string) {
        selectList.handleInput(data);
        tui.requestRender();
      },
    };
  });
