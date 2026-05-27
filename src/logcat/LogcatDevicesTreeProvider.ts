import * as vscode from 'vscode';
import type { AdbDevice } from '../android/AdbBinary';
import type { LogcatService } from './LogcatService';

export class LogcatDevicesTreeProvider implements vscode.TreeDataProvider<DeviceNode> {
  private readonly _onDidChange = new vscode.EventEmitter<DeviceNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private devices: AdbDevice[] = [];
  private activeSerial?: string;

  constructor(private readonly service: LogcatService) {
    service.on('devices', (devs: AdbDevice[]) => {
      this.devices = devs;
      this._onDidChange.fire(undefined);
    });
  }

  setActive(serial: string | undefined): void {
    this.activeSerial = serial;
    this._onDidChange.fire(undefined);
  }

  refresh(): void {
    void this.service.listDevices();
  }

  getTreeItem(node: DeviceNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    item.description = node.description;
    item.contextValue = node.state;
    item.iconPath = new vscode.ThemeIcon(
      node.state === 'device' ? 'device-mobile'
        : node.state === 'unauthorized' ? 'warning'
        : 'circle-slash',
      node.serial === this.activeSerial ? new vscode.ThemeColor('charts.green') : undefined,
    );
    item.command = {
      command: 'kotlinJump.logcat.pickDevice',
      title:   'Switch Device',
      arguments: [node.serial],
    };
    return item;
  }

  getChildren(): DeviceNode[] {
    if (this.devices.length === 0) {
      return [{ label: 'No devices connected', description: '', state: 'unknown', serial: '' }];
    }
    return this.devices.map(d => ({
      label:       d.model ?? d.serial,
      description: `${d.serial} · ${d.state}${d.serial === this.activeSerial ? '  ●' : ''}`,
      state:       d.state,
      serial:      d.serial,
    }));
  }
}

interface DeviceNode {
  label:       string;
  description: string;
  state:       AdbDevice['state'];
  serial:      string;
}
