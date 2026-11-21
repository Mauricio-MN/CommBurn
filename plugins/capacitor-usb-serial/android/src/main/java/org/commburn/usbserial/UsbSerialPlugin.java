package org.commburn.usbserial;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbManager;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.hoho.android.usbserial.driver.UsbSerialDriver;
import com.hoho.android.usbserial.driver.UsbSerialPort;
import com.hoho.android.usbserial.driver.UsbSerialProber;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "UsbSerial")
public class UsbSerialPlugin extends Plugin {
    private static final String PERMISSION_ACTION = "org.commburn.usbserial.USB_PERMISSION";
    private static final int READ_TIMEOUT_MS = 100;
    private static final int WRITE_TIMEOUT_MS = 1000;

    // All port operations run on this single thread so writes keep their order and open/close never overlap.
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private UsbManager usbManager;
    private volatile UsbSerialPort port;
    private volatile boolean reading;

    @Override
    public void load() {
        usbManager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
    }

    @PluginMethod
    public void list(PluginCall call) {
        JSArray ports = new JSArray();
        for (UsbSerialDriver driver : UsbSerialProber.getDefaultProber().findAllDrivers(usbManager)) {
            UsbDevice device = driver.getDevice();
            JSObject entry = new JSObject();
            entry.put("path", device.getDeviceName());
            entry.put("manufacturer", device.getManufacturerName());
            entry.put("product", device.getProductName());
            entry.put("vendorId", device.getVendorId());
            entry.put("productId", device.getProductId());
            ports.put(entry);
        }
        JSObject result = new JSObject();
        result.put("ports", ports);
        call.resolve(result);
    }

    @PluginMethod
    public void open(PluginCall call) {
        String path = call.getString("path", "");
        int baudRate = call.getInt("baudRate", 115200);
        io.execute(() -> {
            closePort();
            UsbSerialDriver driver = findDriver(path);
            if (driver == null) {
                call.reject("Dispositivo USB não encontrado. Reconecte o cabo e atualize a lista.", "device-not-found");
                return;
            }
            UsbDevice device = driver.getDevice();
            if (!usbManager.hasPermission(device)) {
                requestPermission(device);
                call.reject("Permissão USB solicitada. Confirme na tela do Android e toque em Conectar novamente.", "usb-permission-required");
                return;
            }
            UsbDeviceConnection connection = usbManager.openDevice(device);
            if (connection == null) {
                call.reject("Não foi possível abrir o dispositivo USB.", "usb-open-failed");
                return;
            }
            UsbSerialPort opened = driver.getPorts().get(0);
            try {
                opened.open(connection);
                opened.setParameters(baudRate, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE);
                opened.setDTR(true);
                opened.setRTS(true);
            } catch (IOException | IllegalArgumentException error) {
                closeQuietly(opened);
                call.reject("Não foi possível abrir a porta USB: " + error.getMessage(), "usb-open-failed");
                return;
            }
            port = opened;
            reading = true;
            Thread reader = new Thread(() -> readLoop(opened));
            reader.setDaemon(true);
            reader.start();
            call.resolve();
        });
    }

    @PluginMethod
    public void update(PluginCall call) {
        int baudRate = call.getInt("baudRate", 115200);
        io.execute(() -> {
            UsbSerialPort current = port;
            if (current == null) {
                call.reject("A porta USB não está aberta.", "port-closed");
                return;
            }
            try {
                current.setParameters(baudRate, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE);
                call.resolve();
            } catch (IOException | IllegalArgumentException error) {
                call.reject("Não foi possível alterar a velocidade: " + error.getMessage(), "baud-change-failed");
            }
        });
    }

    @PluginMethod
    public void write(PluginCall call) {
        byte[] bytes = call.getString("data", "").getBytes(StandardCharsets.UTF_8);
        io.execute(() -> {
            UsbSerialPort current = port;
            if (current == null) {
                call.reject("A porta USB não está aberta.", "port-closed");
                return;
            }
            try {
                current.write(bytes, WRITE_TIMEOUT_MS);
                call.resolve();
            } catch (IOException error) {
                call.reject("Falha ao enviar dados pela USB: " + error.getMessage(), "write-failed");
            }
        });
    }

    @PluginMethod
    public void close(PluginCall call) {
        io.execute(() -> {
            closePort();
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        io.execute(this::closePort);
    }

    private UsbSerialDriver findDriver(String path) {
        for (UsbSerialDriver driver : UsbSerialProber.getDefaultProber().findAllDrivers(usbManager)) {
            if (driver.getDevice().getDeviceName().equals(path)) return driver;
        }
        return null;
    }

    private void requestPermission(UsbDevice device) {
        Intent intent = new Intent(PERMISSION_ACTION).setPackage(getContext().getPackageName());
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0;
        usbManager.requestPermission(device, PendingIntent.getBroadcast(getContext(), 0, intent, flags));
    }

    private void readLoop(UsbSerialPort current) {
        byte[] buffer = new byte[256];
        while (reading && port == current) {
            try {
                int count = current.read(buffer, READ_TIMEOUT_MS);
                if (count > 0) {
                    JSObject event = new JSObject();
                    event.put("data", new String(buffer, 0, count, StandardCharsets.UTF_8));
                    notifyListeners("data", event);
                }
            } catch (IOException error) {
                if (reading && port == current) {
                    JSObject event = new JSObject();
                    event.put("message", error.getMessage());
                    notifyListeners("error", event);
                }
                return;
            }
        }
    }

    private void closePort() {
        reading = false;
        UsbSerialPort current = port;
        port = null;
        if (current != null) closeQuietly(current);
    }

    private static void closeQuietly(UsbSerialPort serialPort) {
        try {
            serialPort.close();
        } catch (IOException ignored) {
            // The device may already be detached; nothing else to release.
        }
    }
}
