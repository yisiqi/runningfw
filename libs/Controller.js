jQuery.sap.declare("inspur.gsp.commons.Controller")

sap.ui.core.mvc.Controller.extend("inspur.gsp.commons.Controller", {

  getModel  : function() {
    var view = this.getView()
    return view.getModel.apply(view, arguments)
  }

  , getRuntime: function() {
    return this.getModel("runtime")
  }

})